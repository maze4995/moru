import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  Timestamp as ClientTimestamp,
} from "firebase/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { admin } from "../src/server/firebase";
import { blankPlan, blankTask } from "../src/domain/model";
import { saveEntity, saveSettings } from "../src/server/repository";
import { reconcile, runReminders } from "../src/server/reminders";
import { GET, POST } from "../src/app/api/data/route";
import { GET as scheduleGET } from "../src/app/api/schedule/route";
import {
  fetchEvents,
  connectionRef,
  seal,
  unseal,
  beginConnect,
  completeConnect,
  scopes,
} from "../src/server/calendar";
let env: RulesTestEnvironment, token: string, outsider: string;
const uid = "test-owner";
beforeAll(async () => {
  process.env.FIREBASE_PROJECT_ID = "demo-moru-tests";
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8088";
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9098";
  process.env.OWNER_UID = uid;
  process.env.APP_ORIGIN = "http://localhost:3000";
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.EMAIL_MODE = "test";
  env = await initializeTestEnvironment({
    projectId: "demo-moru-tests",
    firestore: {
      host: "127.0.0.1",
      port: 8088,
      rules: readFileSync("firestore.rules", "utf8"),
    },
  });
  await env.clearFirestore();
  const { db, auth } = admin();
  await db.doc("access/owner").set({ uid });
  for (const id of [uid, "outsider"]) {
    try {
      await auth.deleteUser(id);
    } catch {}
    await auth.createUser({
      uid: id,
      email: `${id}@example.test`,
      emailVerified: true,
      password: "testing-only",
    });
  }
  async function signin(id: string) {
    const r = await fetch(
      "http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: `${id}@example.test`,
          password: "testing-only",
          returnSecureToken: true,
        }),
      },
    );
    return (await r.json()).idToken;
  }
  token = await signin(uid);
  outsider = await signin("outsider");
  await saveSettings(uid, { timezone: "Asia/Seoul", emailEnabled: false });
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await env.cleanup();
});
function request(body?: any, t = token) {
  return new Request("http://localhost:3000/api/data?kind=tasks", {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
describe("server authentication and persistence", () => {
  it("blocks missing, forged and non-owner authentication", async () => {
    expect(
      (await GET(new Request("http://localhost:3000/api/data?kind=tasks")))
        .status,
    ).toBe(401);
    expect((await GET(request(undefined, "forged"))).status).toBe(401);
    expect((await GET(request(undefined, outsider))).status).toBe(403);
  });
  it("validates owner, fields and related plan category", async () => {
    expect(
      (
        await POST(
          request({
            kind: "tasks",
            version: 0,
            data: { ...blankTask, title: "x", uid: "outsider" },
          }),
        )
      ).status,
    ).toBe(400);
    await saveEntity(
      uid,
      "plans",
      "p",
      { ...blankPlan, title: "plan", category: "취업", status: "진행 중" },
      0,
    );
    expect(
      (
        await POST(
          request({
            kind: "tasks",
            version: 0,
            data: { ...blankTask, title: "x", planId: "p", category: "학습" },
          }),
        )
      ).status,
    ).toBe(400);
  });
  it("creates, updates, pauses, completes, reopens and soft deletes with persisted Timestamp", async () => {
    let t = await saveEntity(
      uid,
      "tasks",
      "crud",
      {
        ...blankTask,
        title: "task",
        dueDate: "2026-10-07",
        startAt: "2026-10-07T01:00:00Z",
        endAt: "2026-10-07T02:00:00Z",
      },
      0,
    );
    for (const status of ["보류", "완료", "할 일"] as const) {
      const { id, uid: u, updatedAt, version, ...data } = t;
      t = await saveEntity(uid, "tasks", "crud", { ...data, status }, version);
    }
    const raw = (await admin().db.doc(`users/${uid}/tasks/crud`).get()).data()!;
    expect(raw.startAt).toBeInstanceOf(Timestamp);
    expect(raw.dueDate).toBe("2026-10-07");
    const { id, uid: u, updatedAt, version, ...data } = t;
    await saveEntity(uid, "tasks", "crud", { ...data, deleted: true }, version);
    expect(
      (await admin().db.doc(`users/${uid}/tasks/crud`).get()).data()!.deleted,
    ).toBe(true);
    expect(
      (await (await GET(request())).json()).items.some(
        (x: any) => x.id === "crud",
      ),
    ).toBe(true);
    await expect(saveEntity(uid, "tasks", "crud", data, 0)).rejects.toThrow(
      "다른 화면",
    );
  });
  it("rejects foreign origin and UID fields on Admin SDK API", async () => {
    const r = new Request("http://localhost:3000/api/data", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: "https://evil.example",
      },
      body: "{}",
    });
    expect((await POST(r)).status).toBe(403);
    await admin()
      .db.doc(`users/${uid}/tasks/foreign`)
      .set({ uid: "outsider", version: 1 });
    await expect(
      saveEntity(uid, "tasks", "foreign", { ...blankTask, title: "bad" }, 1),
    ).rejects.toThrow("소유권");
  });
});
describe("security rules", () => {
  const payload = () => ({
    ...blankTask,
    title: "valid",
    uid,
    version: 1,
    updatedAt: ClientTimestamp.now(),
  });
  it("denies anonymous, non-owner and cross-UID reads", async () => {
    await assertFails(
      getDoc(
        doc(
          env.unauthenticatedContext().firestore(),
          `users/${uid}/tasks/crud`,
        ),
      ),
    );
    await assertFails(
      getDoc(
        doc(
          env.authenticatedContext("outsider").firestore(),
          `users/${uid}/tasks/crud`,
        ),
      ),
    );
    await assertFails(
      getDoc(
        doc(
          env.authenticatedContext(uid).firestore(),
          "users/outsider/tasks/x",
        ),
      ),
    );
    await assertSucceeds(
      getDoc(
        doc(
          env.authenticatedContext(uid).firestore(),
          `users/${uid}/tasks/crud`,
        ),
      ),
    );
  });
  it("allows valid owned task, rejects unknown fields, forged owner, invalid fields and hard deletion", async () => {
    const db = env.authenticatedContext(uid).firestore();
    await assertSucceeds(
      setDoc(doc(db, `users/${uid}/tasks/rule-ok`), payload()),
    );
    for (const [i, patch] of [
      { extra: "x" },
      { uid: "outsider" },
      { title: "" },
      { priority: "urgent" },
      { dueDate: "tomorrow" },
      { dueDate: "2026-02-30" },
      { dueDate: "2026-13-01" },
      { startAt: ClientTimestamp.now(), endAt: null },
      { planId: "p", category: "학습" },
    ].entries())
      await assertFails(
        setDoc(doc(db, `users/${uid}/tasks/bad-${i}`), {
          ...payload(),
          ...patch,
        }),
      );
    await assertFails(deleteDoc(doc(db, `users/${uid}/tasks/rule-ok`)));
    await assertFails(
      updateDoc(doc(db, `users/${uid}/tasks/rule-ok`), {
        version: 2,
        uid: "outsider",
      }),
    );
  });
  it("denies all token, access policy and notification writes/reads as appropriate", async () => {
    const db = env.authenticatedContext(uid).firestore();
    for (const path of [
      "privateCalendar/test-owner",
      "oauthStates/x",
      "access/owner",
    ]) {
      await assertFails(getDoc(doc(db, path)));
      await assertFails(setDoc(doc(db, path), { uid }));
    }
    await assertFails(
      setDoc(doc(db, `users/${uid}/notifications/fake`), { status: "sent" }),
    );
    await assertFails(
      setDoc(doc(db, `users/${uid}/settings/preferences`), {
        timezone: "UTC",
        uid,
      }),
    );
  });
});
describe("reminder reconciliation and delivery", () => {
  it("updates dates, cancels completion/deletion and deduplicates parallel runners", async () => {
    await saveEntity(
      uid,
      "tasks",
      "notify",
      {
        ...blankTask,
        title: "알림",
        dueDate: "2026-10-07",
        reminder: { ...blankTask.reminder, enabled: true },
      },
      0,
    );
    await reconcile(uid);
    const ref = admin().db.doc(`users/${uid}/tasks/notify`);
    await ref.update({ dueDate: "2026-10-08", version: 2 });
    await runReminders(Date.parse("2026-10-07T00:00:00Z"));
    const before = await admin()
      .db.collection(`users/${uid}/notifications`)
      .where("taskId", "==", "notify")
      .get();
    expect(before.docs.some((d) => d.data().status === "cancelled")).toBe(true);
    await Promise.all([
      runReminders(Date.parse("2026-10-08T00:00:01Z")),
      runReminders(Date.parse("2026-10-08T00:00:01Z")),
    ]);
    const sent = await admin()
      .db.collection(`users/${uid}/notifications`)
      .where("taskId", "==", "notify")
      .get();
    expect(sent.docs.filter((d) => d.data().status === "sent")).toHaveLength(1);
    await ref.update({ version: 3, dueDate: "2026-10-09" });
    await reconcile(uid);
    await ref.update({ version: 4, status: "완료" });
    await runReminders(Date.parse("2026-10-09T00:00:01Z"));
    const final = await admin()
      .db.collection(`users/${uid}/notifications`)
      .where("taskId", "==", "notify")
      .get();
    expect(final.docs.filter((d) => d.data().status === "sent")).toHaveLength(
      1,
    );
  });
  it("test email sends no HTTP and candidate schedules do not get jobs", async () => {
    await saveSettings(uid, { timezone: "Asia/Seoul", emailEnabled: true });
    const send = vi.fn();
    await saveEntity(
      uid,
      "tasks",
      "test-email",
      {
        ...blankTask,
        title: "test",
        dueDate: "2026-10-07",
        reminder: { ...blankTask.reminder, enabled: true },
      },
      0,
    );
    await runReminders(Date.parse("2026-10-07T00:00:01Z"), send);
    expect(send).not.toHaveBeenCalled();
    expect(
      (
        await admin()
          .db.collection(`users/${uid}/notifications`)
          .where("taskId", "==", "test-email")
          .get()
      ).docs[0].data().emailStatus,
    ).toBe("test");
    await saveEntity(
      uid,
      "plans",
      "candidate",
      { ...blankPlan, title: "candidate" },
      0,
    );
    await saveEntity(
      uid,
      "tasks",
      "candidate-task",
      {
        ...blankTask,
        title: "candidate task",
        planId: "candidate",
        dueDate: "2026-10-07",
        reminder: { ...blankTask.reminder, enabled: true },
      },
      0,
    );
    await reconcile(uid);
    expect(
      (
        await admin()
          .db.collection(`users/${uid}/notifications`)
          .where("taskId", "==", "candidate-task")
          .get()
      ).size,
    ).toBe(0);
  });
});
describe("additional lifecycle guarantees", () => {
  it("supports plan transitions, restoration, safe links and category consistency", async () => {
    let p = await saveEntity(
      uid,
      "plans",
      "lifecycle-plan",
      { ...blankPlan, title: "계획", links: ["https://example.com/job"] },
      0,
    );
    for (const status of ["진행 중", "보류", "완료", "진행 중"] as const) {
      const { id, uid: u, version, updatedAt, ...data } = p;
      p = await saveEntity(uid, "plans", p.id, { ...data, status }, version);
    }
    const { id, uid: u, version, updatedAt, ...data } = p;
    await saveEntity(uid, "plans", p.id, { ...data, deleted: true }, version);
    await saveEntity(
      uid,
      "plans",
      p.id,
      { ...data, deleted: false },
      version + 1,
    );
    await expect(
      saveEntity(
        uid,
        "plans",
        "unsafe",
        { ...blankPlan, title: "x", links: ["javascript:alert(1)"] },
        0,
      ),
    ).rejects.toThrow();
    await saveEntity(
      uid,
      "tasks",
      "linked",
      { ...blankTask, title: "linked", planId: p.id },
      0,
    );
    await expect(
      saveEntity(
        uid,
        "plans",
        p.id,
        { ...data, category: "취업" },
        version + 2,
      ),
    ).rejects.toThrow("분야");
  });
  it("retries with one stable delivery key and never resends for a note/title edit", async () => {
    process.env.EMAIL_MODE = "live";
    process.env.SCHEDULER_ENABLED = "true";
    process.env.RESEND_API_KEY = "test-provider-key";
    process.env.EMAIL_FROM = "test@example.test";
    await saveSettings(uid, { timezone: "Asia/Seoul", emailEnabled: true });
    await saveEntity(
      uid,
      "tasks",
      "retry",
      {
        ...blankTask,
        title: "원래 제목",
        dueDate: "2026-10-11",
        reminder: { ...blankTask.reminder, enabled: true },
      },
      0,
    );
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(undefined);
    const now = Date.parse("2026-10-11T00:00:00Z");
    await runReminders(now, send);
    await admin()
      .db.doc(`users/${uid}/tasks/retry`)
      .update({ notes: "메모만 변경", title: "변경 제목", version: 2 });
    await Promise.all([
      runReminders(now + 301000, send),
      runReminders(now + 301000, send),
    ]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
    expect(send.mock.calls[1][2]).toBe("원래 제목");
    await runReminders(now + 600000, send);
    expect(send).toHaveBeenCalledTimes(2);
    process.env.EMAIL_MODE = "test";
  });
  it("cancels future deleted jobs and recalculates timezone without mutating date-only fields", async () => {
    await saveEntity(
      uid,
      "tasks",
      "zone",
      {
        ...blankTask,
        title: "zone",
        dueDate: "2026-12-01",
        reminder: { ...blankTask.reminder, enabled: true },
      },
      0,
    );
    await reconcile(uid);
    await saveSettings(uid, { timezone: "UTC", emailEnabled: false });
    await reconcile(uid);
    let jobs = await admin()
      .db.collection(`users/${uid}/notifications`)
      .where("taskId", "==", "zone")
      .get();
    expect(
      jobs.docs.filter((d) => d.data().status === "cancelled"),
    ).toHaveLength(1);
    expect(
      jobs.docs
        .find((d) => d.data().status === "scheduled")!
        .data()
        .dueAt.toDate()
        .toISOString(),
    ).toBe("2026-12-01T09:00:00.000Z");
    expect(
      (await admin().db.doc(`users/${uid}/tasks/zone`).get()).data()!.dueDate,
    ).toBe("2026-12-01");
    await admin()
      .db.doc(`users/${uid}/tasks/zone`)
      .update({ deleted: true, version: 2 });
    await reconcile(uid);
    jobs = await admin()
      .db.collection(`users/${uid}/notifications`)
      .where("taskId", "==", "zone")
      .get();
    expect(jobs.docs.every((d) => d.data().status === "cancelled")).toBe(true);
  });
  it("rejects email opt-in for an unverified address", async () => {
    await admin().auth.updateUser(uid, { emailVerified: false });
    await expect(
      saveSettings(uid, { timezone: "UTC", emailEnabled: true }),
    ).rejects.toThrow("확인된");
    await admin().auth.updateUser(uid, { emailVerified: true });
  });
});
describe("calendar server with mocked Google transport", () => {
  it("uses a one-time OAuth state with minimal read scopes and keeps token response private", async () => {
    process.env.GOOGLE_CLIENT_ID = "test-client";
    process.env.GOOGLE_CLIENT_SECRET = "test-secret";
    process.env.GOOGLE_REDIRECT_URI =
      "http://localhost:3000/api/calendar/callback";
    const connect = await beginConnect(uid);
    const url = new URL(connect.url);
    expect(url.searchParams.get("scope")?.split(" ")).toEqual(scopes);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    await expect(completeConnect("invalid-state", "code")).rejects.toThrow(
      "만료",
    );
    const mock = vi
      .fn()
      .mockResolvedValue(
        Response.json({
          access_token: "private-access",
          refresh_token: "private-refresh",
          expires_in: 3600,
          scope: scopes.join(" "),
        }),
      );
    vi.stubGlobal("fetch", mock);
    await completeConnect(connect.state, "test-code");
    expect((await connectionRef(uid).get()).data()!.tokens).not.toContain(
      "private-access",
    );
    await expect(completeConnect(connect.state, "test-code")).rejects.toThrow(
      "만료",
    );
    expect(mock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
  it("encrypts token contents and fetches expanded recurring events with pagination", async () => {
    const secret = seal({ access: "sensitive" });
    expect(secret).not.toContain("sensitive");
    expect(unseal(secret)).toEqual({ access: "sensitive" });
    await connectionRef(uid).set({
      tokens: seal({
        access: "test-token",
        refresh: "refresh",
        expires: Date.now() + 3600000,
      }),
      selected: ["a"],
      lastSync: null,
    });
    const mock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          items: [
            {
              id: "e",
              summary: "old",
              start: { date: "2026-10-07" },
              end: { date: "2026-10-08" },
            },
          ],
          nextPageToken: "next",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          items: [
            {
              id: "e",
              summary: "changed",
              start: { date: "2026-10-07" },
              end: { date: "2026-10-08" },
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", mock);
    const result = await fetchEvents(
      uid,
      "2026-10-01T00:00:00Z",
      "2026-11-01T00:00:00Z",
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe("changed");
    expect(mock.mock.calls[0][0]).toContain("singleEvents=true");
    expect(mock.mock.calls[1][0]).toContain("pageToken=next");
    vi.unstubAllGlobals();
  });
  it("replaces cancellation snapshots and reports failures independently of app tasks", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ items: [{ id: "e", status: "cancelled" }] }),
        ),
    );
    expect(
      (await fetchEvents(uid, "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z"))
        .events,
    ).toEqual([]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 403 })),
    );
    await expect(
      fetchEvents(uid, "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z"),
    ).rejects.toThrow("읽지 못했습니다");
    expect((await connectionRef(uid).get()).data()!.error).toContain(
      "동기화 실패",
    );
    vi.unstubAllGlobals();
    expect((await GET(request())).status).toBe(200);
  });
});
describe("period queries", () => {
  it("reactivates an unsent cancelled reservation when a completed task is reopened", async () => {
    await saveEntity(
      uid,
      "tasks",
      "reopen-reminder",
      {
        ...blankTask,
        title: "reopen",
        dueDate: "2026-12-20",
        reminder: { ...blankTask.reminder, enabled: true },
      },
      0,
    );
    await reconcile(uid);
    const taskRef = admin().db.doc(`users/${uid}/tasks/reopen-reminder`);
    await taskRef.update({ status: "완료", version: 2 });
    await reconcile(uid);
    const q = admin()
      .db.collection(`users/${uid}/notifications`)
      .where("taskId", "==", "reopen-reminder");
    expect((await q.get()).docs[0].data().status).toBe("cancelled");
    await taskRef.update({ status: "할 일", version: 3 });
    await reconcile(uid);
    expect((await q.get()).docs[0].data().status).toBe("scheduled");
    expect((await q.get()).size).toBe(1);
  });
  it("returns overlapping execution intervals and preserves date deadlines", async () => {
    await saveEntity(
      uid,
      "tasks",
      "overnight",
      {
        ...blankTask,
        title: "overnight",
        dueDate: "2026-11-20",
        startAt: "2026-11-19T23:00:00Z",
        endAt: "2026-11-20T02:00:00Z",
      },
      0,
    );
    const response = await scheduleGET(
      new Request(
        "http://localhost:3000/api/schedule?from=2026-11-20T00%3A00%3A00Z&to=2026-11-21T00%3A00%3A00Z",
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );
    expect(response.status).toBe(200);
    const t = (await response.json()).items.find(
      (t: any) => t.id === "overnight",
    );
    expect(t.dueDate).toBe("2026-11-20");
    expect(t.startAt).toBe("2026-11-19T23:00:00.000Z");
    expect(
      (
        await scheduleGET(
          new Request(
            "http://localhost:3000/api/schedule?from=2026-01-01&to=2027-01-01",
            { headers: { Authorization: `Bearer ${token}` } },
          ),
        )
      ).status,
    ).toBe(400);
  });
});
