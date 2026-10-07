import { createHash, timingSafeEqual } from "node:crypto";
import { DateTime } from "luxon";
import { Timestamp } from "firebase-admin/firestore";
import { admin, encode, HttpError } from "./firebase";
import { getSettings, saveEntity } from "./repository";
import { createDotsValue, parseDotsInput, type DotsTool } from "../domain/dots";

const digest = (v: string) => createHash("sha256").update(v).digest("hex");
export function dotsConfigured() {
  return /^[A-Za-z0-9_-]{43,128}$/.test(process.env.MORU_DOTS_TOKEN || "");
}
export async function authorizeDots(req: Request) {
  if (!dotsConfigured()) throw new HttpError(503, "dots 연결 설정이 없습니다");
  if (req.headers.has("origin"))
    throw new HttpError(403, "브라우저에서 연결 토큰을 사용할 수 없습니다");
  const supplied =
    req.headers
      .get("authorization")
      ?.match(/^Bearer ([A-Za-z0-9_-]{43,128})$/)?.[1] || "";
  if (
    !timingSafeEqual(
      Buffer.from(digest(supplied)),
      Buffer.from(digest(process.env.MORU_DOTS_TOKEN!)),
    )
  )
    throw new HttpError(401, "유효한 dots 연결 인증이 필요합니다");
  const uid = process.env.OWNER_UID;
  if (!uid) throw new HttpError(403, "소유자 설정이 필요합니다");
  const { db, auth } = admin();
  const [owner, connection] = await Promise.all([
    db.doc("access/owner").get(),
    db.doc(`privateDots/${uid}`).get(),
  ]);
  if (
    owner.data()?.uid !== uid ||
    connection.data()?.uid !== uid ||
    !connection.data()?.enabled ||
    connection.data()?.tokenHash !== digest(process.env.MORU_DOTS_TOKEN!)
  )
    throw new HttpError(
      403,
      "dots 접근이 허용되지 않았거나 연결 해제되었습니다",
    );
  const user = await auth.getUser(uid).catch(() => null);
  if (!user || user.disabled)
    throw new HttpError(403, "사용할 수 없는 소유자 계정입니다");
  return uid;
}
export async function setDotsAccess(uid: string, enabled: boolean) {
  if (enabled && !dotsConfigured())
    throw new HttpError(503, "서버의 dots 연결 설정을 먼저 준비하세요");
  await admin()
    .db.doc(`privateDots/${uid}`)
    .set({
      uid,
      enabled,
      tokenHash: enabled ? digest(process.env.MORU_DOTS_TOKEN!) : null,
      updatedAt: Timestamp.now(),
    });
}
export async function dotsStatus(uid: string) {
  const { db } = admin();
  const [connection, history] = await Promise.all([
    db.doc(`privateDots/${uid}`).get(),
    db
      .collection(`privateDots/${uid}/operations`)
      .orderBy("updatedAt", "desc")
      .limit(10)
      .get(),
  ]);
  if (
    (connection.exists && connection.data()?.uid !== uid) ||
    history.docs.some((d) => d.data().uid !== uid)
  )
    throw new HttpError(403, "소유권 오류");
  return {
    configured: dotsConfigured(),
    enabled:
      dotsConfigured() &&
      connection.data()?.enabled === true &&
      connection.data()?.tokenHash === digest(process.env.MORU_DOTS_TOKEN!),
    history: history.docs.map((d) => {
      const v = d.data();
      return {
        requestId: d.id,
        kind: v.kind,
        entityId: v.entityId,
        title: v.title,
        action: v.action,
        updatedAt: encode(v.updatedAt),
        version: v.result.version,
      };
    }),
  };
}
export async function executeDots(uid: string, tool: DotsTool, raw: unknown) {
  const args = parseDotsInput(tool, raw) as Record<string, any>;
  const db = admin().db;
  if (tool === "moru_context") {
    const settings = await getSettings(uid);
    const now = DateTime.now().setZone(settings.timezone);
    return {
      timezone: settings.timezone,
      now: now.toISO(),
      today: now.toISODate(),
      writeMode: "explicit_requests_immediate",
      candidateStatus: "검토 중",
    };
  }
  const kind =
    tool.endsWith("plans") || tool.endsWith("plan") ? "plans" : "tasks";
  const collection = db.collection(`users/${uid}/${kind}`);
  if (tool.includes("_list_")) {
    let query = collection.orderBy("updatedAt", "desc").limit(50);
    if (args.cursor) {
      const cursor = await collection.doc(args.cursor).get();
      if (!cursor.exists)
        throw new HttpError(400, "다시 목록을 조회하세요. 커서가 없습니다");
      if (cursor.data()?.uid !== uid) throw new HttpError(403, "소유권 오류");
      query = query.startAfter(cursor);
    }
    const result = await query.get();
    if (result.docs.some((d) => d.data().uid !== uid))
      throw new HttpError(403, "소유권 오류");
    return {
      items: result.docs.map((d) => {
        const v = encode(d.data());
        return {
          id: d.id,
          title: v.title,
          category: v.category,
          status: v.status,
          deleted: v.deleted,
          version: v.version,
          ...(kind === "tasks"
            ? {
                planId: v.planId,
                dueDate: v.dueDate,
                startAt: v.startAt,
                endAt: v.endAt,
              }
            : { targetDate: v.targetDate }),
        };
      }),
      cursor: result.size === 50 ? result.docs.at(-1)!.id : null,
    };
  }
  if (tool.includes("_get_")) {
    const snap = await collection.doc(args.id).get();
    if (!snap.exists) throw new HttpError(404, "항목이 없습니다");
    if (snap.data()?.uid !== uid) throw new HttpError(403, "소유권 오류");
    return { item: { id: snap.id, ...encode(snap.data()) } };
  }
  const partial = tool.includes("_update_");
  const id = partial
    ? args.id
    : `dots_${digest(`${uid}:${args.requestId}`).slice(0, 32)}`;
  const result = await saveEntity(
    uid,
    kind,
    id,
    partial ? args.changes : createDotsValue(kind, args.data),
    partial ? args.version : 0,
    { requestId: args.requestId, partial },
  );
  return {
    saved: true,
    requestId: args.requestId,
    item: result,
    note: "재시도에는 이 요청 ID와 같은 인수를 사용하세요. 재시도 결과는 최초 저장 결과입니다.",
  };
}
