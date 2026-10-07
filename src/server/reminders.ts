import { createHash, randomUUID } from "node:crypto";
import { Timestamp, FieldPath } from "firebase-admin/firestore";
import { admin, encode } from "./firebase";
import { defaultSettings, reminderTime, type Task } from "../domain/model";
export function jobKey(
  uid: string,
  t: Task,
  zone: string,
  planVersion: number,
) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        uid,
        t.id,
        zone,
        t.dueDate,
        t.startAt,
        t.reminder,
        reminderTime(t, zone),
      ]),
    )
    .digest("hex");
}
async function current(
  tx: FirebaseFirestore.Transaction,
  uid: string,
  taskId: string,
) {
  const db = admin().db;
  const [taskSnap, settingsSnap] = await Promise.all([
    tx.get(db.doc(`users/${uid}/tasks/${taskId}`)),
    tx.get(db.doc(`users/${uid}/settings/preferences`)),
  ]);
  if (!taskSnap.exists) return null;
  const t = { id: taskSnap.id, ...encode(taskSnap.data()) } as Task,
    settings = settingsSnap.data() || defaultSettings;
  let planVersion = 0;
  if (t.planId) {
    const p = (await tx.get(db.doc(`users/${uid}/plans/${t.planId}`))).data();
    if (!p || p.uid !== uid || p.deleted || p.status !== "진행 중") return null;
    planVersion = p.version;
  }
  if (t.uid !== uid) return null;
  const at = reminderTime(t, settings.timezone);
  return at
    ? {
        task: t,
        settings,
        at,
        key: jobKey(uid, t, settings.timezone, planVersion),
      }
    : null;
}
export async function reconcile(uid: string) {
  const db = admin().db;
  let cursor: string | undefined;
  let count = 0;
  do {
    let query = db
      .collection(`users/${uid}/tasks`)
      .where("reminder.enabled", "==", true)
      .where("deleted", "==", false)
      .where("status", "in", ["할 일", "진행 중"])
      .orderBy(FieldPath.documentId())
      .limit(100);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const doc of page.docs) {
      await db.runTransaction(async (tx) => {
        const source = await current(tx, uid, doc.id);
        if (!source) return;
        const ref = db.doc(`users/${uid}/notifications/${source.key}`),
          exists = await tx.get(ref);
        if (!exists.exists) {
          tx.create(ref, {
            uid,
            taskId: doc.id,
            title: source.task.title,
            dueAt: Timestamp.fromDate(new Date(source.at)),
            updatedAt: Timestamp.now(),
            status: "scheduled",
            emailStatus: "pending",
            attempts: 0,
            leaseUntil: Timestamp.fromMillis(0),
            firstAttemptAt: null,
            error: null,
          });
          count++;
        } else if (
          exists.data()?.status === "cancelled" &&
          !exists.data()?.firstAttemptAt
        ) {
          // Reopening/rescheduling back to the same time restores an unsent job.
          // Never reset attempts or delivery history after a provider request.
          tx.update(ref, {
            status: "scheduled",
            emailStatus: "pending",
            title: source.task.title,
            error: null,
            updatedAt: Timestamp.now(),
            leaseUntil: Timestamp.fromMillis(0),
          });
        }
      });
    }
    cursor = page.size === 100 ? page.docs.at(-1)!.id : undefined;
  } while (cursor);
  // Cancel outdated reservations even when their old due date is in the future.
  cursor = undefined;
  do {
    let query = db
      .collection(`users/${uid}/notifications`)
      .where("status", "in", ["scheduled", "processing", "failed"])
      .orderBy(FieldPath.documentId())
      .limit(100);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const doc of page.docs)
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(doc.ref);
        const data = fresh.data()!;
        if (!["scheduled", "processing", "failed"].includes(data.status))
          return;
        const source = await current(tx, uid, data.taskId);
        if (!source || source.key !== doc.id)
          tx.update(doc.ref, {
            status: "cancelled",
            emailStatus: "cancelled",
            updatedAt: Timestamp.now(),
          });
      });
    cursor = page.size === 100 ? page.docs.at(-1)!.id : undefined;
  } while (cursor);
  return count;
}
export async function runReminders(
  now = Date.now(),
  send?: (key: string, email: string, title: string) => Promise<void>,
) {
  const uid = process.env.OWNER_UID;
  if (!uid) throw new Error("OWNER_UID required");
  const { db, auth } = admin();
  if ((await db.doc("access/owner").get()).data()?.uid !== uid)
    throw new Error("Owner policy mismatch");
  await reconcile(uid);
  const pending = await db
    .collection(`users/${uid}/notifications`)
    .where("status", "in", ["scheduled", "processing", "failed"])
    .where("dueAt", "<=", Timestamp.fromMillis(now))
    .orderBy("dueAt")
    .limit(200)
    .get();
  let delivered = 0;
  for (const doc of pending.docs) {
    const lease = randomUUID();
    const claim = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(doc.ref),
        data = fresh.data()!;
      if (!["scheduled", "processing", "failed"].includes(data.status))
        return null;
      const source = await current(tx, uid, data.taskId);
      if (!source || source.key !== doc.id) {
        tx.update(doc.ref, {
          status: "cancelled",
          emailStatus: "cancelled",
          updatedAt: Timestamp.now(),
        });
        return null;
      }
      if (data.dueAt.toMillis() > now || data.leaseUntil.toMillis() > now)
        return null;
      if (
        data.firstAttemptAt &&
        now - data.firstAttemptAt.toMillis() > 20 * 3600000
      ) {
        tx.update(doc.ref, {
          status: "failed-final",
          error: "안전한 재시도 기간 초과 · 발송 여부 확인 필요",
          updatedAt: Timestamp.now(),
        });
        return null;
      }
      tx.update(doc.ref, {
        status: "processing",
        lease,
        leaseUntil: Timestamp.fromMillis(now + 120000),
        firstAttemptAt: data.firstAttemptAt || Timestamp.fromMillis(now),
        attempts: data.attempts + 1,
        updatedAt: Timestamp.now(),
      });
      return { ...source, deliveryTitle: data.title };
    });
    if (!claim) continue;
    try {
      const user = await auth.getUser(uid);
      const delivery = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(doc.ref),
          data = fresh.data()!;
        const source = await current(tx, uid, data.taskId);
        if (data.lease !== lease || data.status !== "processing") return null;
        if (!source || source.key !== doc.id || user.disabled) {
          tx.update(doc.ref, {
            status: "cancelled",
            emailStatus: "cancelled",
            updatedAt: Timestamp.now(),
          });
          return null;
        }
        const recipient = data.emailTo ?? user.email ?? null;
        if (!("emailTo" in data)) tx.update(doc.ref, { emailTo: recipient });
        return { settings: source.settings, recipient };
      });
      if (!delivery) continue;
      let emailStatus = "disabled";
      if (
        delivery.settings.emailEnabled &&
        user.emailVerified &&
        user.email &&
        delivery.recipient === user.email
      ) {
        if (process.env.EMAIL_MODE !== "live") {
          emailStatus = "test";
        } else if (
          process.env.SCHEDULER_ENABLED === "true" &&
          process.env.RESEND_API_KEY &&
          process.env.EMAIL_FROM
        ) {
          if (send) await send(doc.id, user.email, claim.deliveryTitle);
          else {
            const r = await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
                "Content-Type": "application/json",
                "Idempotency-Key": doc.id,
              },
              body: JSON.stringify({
                from: process.env.EMAIL_FROM,
                to: [user.email],
                subject: `[모루] ${claim.deliveryTitle}`,
                text: `설정한 알림 시간입니다.\n${claim.deliveryTitle}\n앱에서 일정을 확인하세요.`,
              }),
              signal: AbortSignal.timeout(20000),
            });
            if (!r.ok) throw new Error("provider-failure");
          }
          emailStatus = "sent";
        }
      }
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(doc.ref);
        if (fresh.data()?.lease === lease)
          tx.update(doc.ref, {
            status: "sent",
            emailStatus,
            sentAt: Timestamp.fromMillis(now),
            updatedAt: Timestamp.now(),
            error: null,
          });
      });
      delivered++;
    } catch {
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(doc.ref);
        if (fresh.data()?.lease === lease)
          tx.update(doc.ref, {
            status: "failed",
            emailStatus: "failed",
            error: "발송 실패 · 자동 재시도 대기",
            leaseUntil: Timestamp.fromMillis(now + 300000),
            updatedAt: Timestamp.now(),
          });
      });
    }
  }
  return { examined: pending.size, delivered };
}
