import { randomUUID } from "node:crypto";
import {
  authorize,
  admin,
  encode,
  failure,
  checkOrigin,
  HttpError,
} from "@/server/firebase";
import { getSettings, saveEntity, saveSettings } from "@/server/repository";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    const user = await authorize(req);
    const url = new URL(req.url),
      kind = url.searchParams.get("kind");
    if (kind === "settings") return Response.json(await getSettings(user.uid));
    if (!["tasks", "plans", "notifications"].includes(kind || ""))
      throw new HttpError(400, "잘못된 목록");
    let q = admin()
      .db.collection(`users/${user.uid}/${kind}`)
      .orderBy("updatedAt", "desc")
      .limit(100);
    const cursor = url.searchParams.get("cursor");
    if (cursor) {
      if (!/^[\w-]+$/.test(cursor)) throw new HttpError(400, "잘못된 커서");
      const doc = await admin()
        .db.doc(`users/${user.uid}/${kind}/${cursor}`)
        .get();
      if (doc.exists) q = q.startAfter(doc);
    }
    const snap = await q.get();
    if (snap.docs.some((d) => d.data().uid !== user.uid))
      throw new HttpError(403, "소유권 오류");
    return Response.json({
      items: snap.docs.map((d) => ({ id: d.id, ...encode(d.data()) })),
      cursor: snap.size === 100 ? snap.docs.at(-1)!.id : null,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const user = await authorize(req);
    const body = await req.json();
    if (body.kind === "settings")
      return Response.json(await saveSettings(user.uid, body.data));
    if (!["tasks", "plans"].includes(body.kind))
      throw new HttpError(400, "잘못된 종류");
    const id = body.id || randomUUID();
    if (
      !/^[\w-]{1,128}$/.test(id) ||
      !Number.isInteger(body.version) ||
      body.version < 0
    )
      throw new HttpError(400, "잘못된 식별자");
    return Response.json(
      await saveEntity(user.uid, body.kind, id, body.data, body.version),
    );
  } catch (e) {
    return failure(e);
  }
}
