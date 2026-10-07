import { Timestamp } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { admin, encode, HttpError, storeTimes } from "./firebase";
import {
  planSchema,
  taskSchema,
  settingsSchema,
  defaultSettings,
} from "../domain/model";
export async function saveEntity(
  uid: string,
  kind: "tasks" | "plans",
  id: string,
  input: unknown,
  version: number,
  conversation?: { requestId: string; partial: boolean },
) {
  const db = admin().db;
  const ref = db.doc(`users/${uid}/${kind}/${id}`);
  const receiptRef = conversation
    ? db.doc(`privateDots/${uid}/operations/${conversation.requestId}`)
    : null;
  const canonical = (v: any): any =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, canonical(v[k])]),
          )
        : v;
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify(
        canonical({
          kind,
          id,
          input,
          version,
          partial: conversation?.partial ?? false,
        }),
      ),
    )
    .digest("hex");
  return db.runTransaction(async (tx) => {
    if (receiptRef) {
      const receipt = await tx.get(receiptRef);
      if (receipt.exists) {
        if (receipt.data()?.uid !== uid)
          throw new HttpError(403, "소유권 오류");
        if (receipt.data()?.fingerprint !== fingerprint)
          throw new HttpError(
            409,
            "같은 요청 ID에 다른 변경을 사용할 수 없습니다",
          );
        return receipt.data()!.result;
      }
    }
    const snap = await tx.get(ref);
    if (conversation?.partial && !snap.exists)
      throw new HttpError(404, "변경할 항목이 없습니다");
    if ((snap.data()?.version || 0) !== version)
      throw new HttpError(
        409,
        "다른 화면에서 변경되었습니다. 새로고침 후 다시 시도하세요",
      );
    if (snap.exists && snap.data()?.uid !== uid)
      throw new HttpError(403, "소유권 오류");
    const before = snap.exists ? encode(snap.data()) : null;
    const existing = before
      ? Object.fromEntries(
          Object.entries(before).filter(
            ([k]) => !["uid", "version", "updatedAt"].includes(k),
          ),
        )
      : {};
    const value = (kind === "tasks" ? taskSchema : planSchema).parse(
      conversation?.partial ? { ...existing, ...(input as object) } : input,
    );
    if (kind === "tasks" && "planId" in value && value.planId) {
      const plan = await tx.get(db.doc(`users/${uid}/plans/${value.planId}`));
      if (
        !plan.exists ||
        plan.data()?.uid !== uid ||
        plan.data()?.deleted ||
        plan.data()?.category !== value.category
      )
        throw new HttpError(400, "연결 계획의 분야와 일치해야 합니다");
    }
    if (
      kind === "plans" &&
      snap.exists &&
      snap.data()?.category !== value.category
    ) {
      const linked = await tx.get(
        db.collection(`users/${uid}/tasks`).where("planId", "==", id).limit(1),
      );
      if (!linked.empty)
        throw new HttpError(
          400,
          "연결된 할 일이 있으면 분야를 변경할 수 없습니다",
        );
    }
    const stored = {
      ...storeTimes(value),
      uid,
      version: version + 1,
      updatedAt: Timestamp.now(),
    };
    tx.set(ref, stored);
    const result = { id, ...encode(stored) };
    if (receiptRef)
      tx.create(receiptRef, {
        uid,
        fingerprint,
        kind,
        entityId: id,
        title: value.title,
        action: conversation!.partial ? "update" : "create",
        before,
        result,
        updatedAt: stored.updatedAt,
      });
    return result;
  });
}
export async function saveSettings(uid: string, input: unknown) {
  const data = settingsSchema.parse(input);
  if (data.emailEnabled && !(await admin().auth.getUser(uid)).emailVerified)
    throw new HttpError(400, "확인된 본인 이메일이 필요합니다");
  await admin()
    .db.doc(`users/${uid}/settings/preferences`)
    .set({ ...data, uid });
  return data;
}
export async function getSettings(uid: string) {
  const doc = await admin().db.doc(`users/${uid}/settings/preferences`).get();
  if (doc.exists && doc.data()?.uid !== uid)
    throw new HttpError(403, "소유권 오류");
  return settingsSchema.parse(
    doc.exists
      ? {
          timezone: doc.data()!.timezone,
          emailEnabled: doc.data()!.emailEnabled,
        }
      : defaultSettings,
  );
}
