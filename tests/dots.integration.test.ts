import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { admin } from "../src/server/firebase";
import { saveEntity, saveSettings } from "../src/server/repository";
import { blankTask } from "../src/domain/model";
import { setDotsAccess } from "../src/server/dots";
import { reconcile } from "../src/server/reminders";
import { POST } from "../src/app/api/dots/route";
import {
  GET as connectionGET,
  POST as connectionPOST,
} from "../src/app/api/dots/connection/route";

let env: RulesTestEnvironment, ownerToken: string, strangerToken: string;
const uid = "dots-test-owner",
  secret = randomBytes(32).toString("base64url");
beforeAll(async () => {
  Object.assign(process.env, {
    FIREBASE_PROJECT_ID: "demo-moru-tests",
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:8088",
    FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9098",
    OWNER_UID: uid,
    APP_ORIGIN: "http://localhost:3000",
    MORU_DOTS_TOKEN: secret,
  });
  env = await initializeTestEnvironment({
    projectId: "demo-moru-tests",
    firestore: {
      host: "127.0.0.1",
      port: 8088,
      rules: readFileSync("firestore.rules", "utf8"),
    },
  });
  await env.clearFirestore();
  const { auth, db } = admin();
  await db.doc("access/owner").set({ uid });
  const tokens: string[] = [];
  for (const id of [uid, "dots-stranger"]) {
    await auth.deleteUser(id).catch(() => {});
    await auth.createUser({
      uid: id,
      email: `${id}@example.test`,
      emailVerified: true,
      password: "testing-only",
    });
    const response = await fetch(
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
    tokens.push((await response.json()).idToken);
  }
  [ownerToken, strangerToken] = tokens;
  await saveSettings(uid, { timezone: "Asia/Seoul", emailEnabled: false });
});
afterAll(async () => {
  delete process.env.MORU_DOTS_TOKEN;
  await env.cleanup();
});
function bridge(
  tool: string,
  args: unknown = {},
  token = secret,
  origin?: string,
) {
  return new Request("http://localhost:3000/api/dots", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify({ tool, arguments: args }),
  });
}
function connection(enabled?: boolean, token = ownerToken) {
  return new Request("http://localhost:3000/api/dots/connection", {
    method: enabled === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      Origin: "http://localhost:3000",
    },
    ...(enabled === undefined ? {} : { body: JSON.stringify({ enabled }) }),
  });
}
async function call(tool: string, args: unknown = {}) {
  const response = await POST(bridge(tool, args));
  expect(response.status).toBe(200);
  return response.json();
}

describe("dots authenticated bridge and atomic edits", () => {
  it("fails closed without setup, consent or a valid server credential", async () => {
    delete process.env.MORU_DOTS_TOKEN;
    expect((await POST(bridge("moru_context"))).status).toBe(503);
    process.env.MORU_DOTS_TOKEN = secret;
    expect((await POST(bridge("moru_context"))).status).toBe(403);
    expect((await POST(bridge("moru_context", {}, "invalid"))).status).toBe(
      401,
    );
    expect(
      (await POST(bridge("moru_context", {}, secret, "http://localhost:3000")))
        .status,
    ).toBe(403);
  });
  it("allows only the Firebase owner to grant access and never returns the token", async () => {
    expect((await connectionPOST(connection(true, "forged"))).status).toBe(401);
    expect((await connectionPOST(connection(true, strangerToken))).status).toBe(
      403,
    );
    const r = await connectionPOST(connection(true));
    expect(r.status).toBe(200);
    const status = await r.json();
    expect(status.enabled).toBe(true);
    expect(JSON.stringify(status)).not.toContain(secret);
    expect(JSON.stringify(status)).not.toContain("tokenHash");
    expect(await call("moru_context")).toMatchObject({
      timezone: "Asia/Seoul",
      writeMode: "explicit_requests_immediate",
    });
  });
  it("deduplicates concurrent creation atomically and rejects changed reuse", async () => {
    const requestId = randomUUID(),
      args = { requestId, data: { title: "시험 후보", category: "자격증" } };
    const responses = await Promise.all([
      POST(bridge("moru_create_plan", args)),
      POST(bridge("moru_create_plan", args)),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    const results = await Promise.all(responses.map((r) => r.json()));
    expect(results[0]).toEqual(results[1]);
    expect(results[0].item).toMatchObject({ status: "검토 중", version: 1 });
    expect((await admin().db.collection(`users/${uid}/plans`).get()).size).toBe(
      1,
    );
    expect(
      (await admin().db.collection(`privateDots/${uid}/operations`).get()).size,
    ).toBe(1);
    expect(
      (
        await POST(
          bridge("moru_create_plan", {
            ...args,
            data: { ...args.data, title: "다른 요청" },
          }),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await call("moru_create_plan", {
          data: { category: "자격증", title: "시험 후보" },
          requestId,
        })
      ).item.id,
    ).toBe(results[0].item.id);
  });
  it("preserves untouched fields and rejects stale or conflicting edits", async () => {
    const { item } = await call("moru_create_task", {
      requestId: randomUUID(),
      data: {
        title: "접수",
        category: "자격증",
        dueDate: "2026-10-09",
        notes: "유지할 메모",
      },
    });
    expect(item.startAt).toBeNull();
    const args = {
      requestId: randomUUID(),
      id: item.id,
      version: 1,
      changes: { status: "완료" },
    };
    const saved = await call("moru_update_task", args);
    expect(saved.item).toMatchObject({
      status: "완료",
      dueDate: "2026-10-09",
      notes: "유지할 메모",
      version: 2,
    });
    expect(await call("moru_update_task", args)).toEqual(saved);
    expect(
      (
        await POST(
          bridge("moru_update_task", { ...args, requestId: randomUUID() }),
        )
      ).status,
    ).toBe(409);
    const concurrent = await Promise.all(
      ["보류", "할 일"].map((status) =>
        POST(
          bridge("moru_update_task", {
            requestId: randomUUID(),
            id: item.id,
            version: 2,
            changes: { status },
          }),
        ),
      ),
    );
    expect(concurrent.map((r) => r.status).sort()).toEqual([200, 409]);
  });
  it("rejects invalid ownership, fields, dates and plan categories", async () => {
    const { item: plan } = await call("moru_create_plan", {
      requestId: randomUUID(),
      data: { title: "학습 계획", category: "학습" },
    });
    const data = { title: "연결된 행동", category: "학습", planId: plan.id };
    for (const bad of [
      { ...data, category: "취업" },
      { ...data, uid: "other" },
      { ...data, dueDate: "2026-02-30" },
    ])
      expect(
        (
          await POST(
            bridge("moru_create_task", { requestId: randomUUID(), data: bad }),
          )
        ).status,
      ).toBe(400);
    const { item: task } = await call("moru_create_task", {
      requestId: randomUUID(),
      data,
    });
    expect(
      (
        await POST(
          bridge("moru_update_plan", {
            requestId: randomUUID(),
            id: plan.id,
            version: 1,
            changes: { category: "취업" },
          }),
        )
      ).status,
    ).toBe(400);
    await admin()
      .db.doc(`users/${uid}/tasks/${task.id}`)
      .update({ uid: "other" });
    expect((await POST(bridge("moru_get_task", { id: task.id }))).status).toBe(
      403,
    );
    expect(
      (
        await POST(
          bridge("moru_update_task", {
            requestId: randomUUID(),
            id: task.id,
            version: 1,
            changes: { status: "완료" },
          }),
        )
      ).status,
    ).toBe(403);
    await admin().db.doc(`users/${uid}/tasks/${task.id}`).update({ uid });
    expect(
      (await POST(bridge("moru_get_task", { id: "../another" }))).status,
    ).toBe(400);
  });
  it("reschedules and cancels reminders through the existing worker", async () => {
    const { item } = await call("moru_create_task", {
      requestId: randomUUID(),
      data: {
        title: "예약 테스트",
        category: "생활",
        dueDate: "2026-10-09",
        reminder: {
          enabled: true,
          basis: "deadline",
          minutesBefore: 0,
          deadlineTime: "09:00",
        },
      },
    });
    await reconcile(uid);
    await call("moru_update_task", {
      requestId: randomUUID(),
      id: item.id,
      version: 1,
      changes: { dueDate: "2026-10-10" },
    });
    await reconcile(uid);
    const jobs = admin()
      .db.collection(`users/${uid}/notifications`)
      .where("taskId", "==", item.id);
    expect((await jobs.get()).docs.map((d) => d.data().status).sort()).toEqual([
      "cancelled",
      "scheduled",
    ]);
    await call("moru_update_task", {
      requestId: randomUUID(),
      id: item.id,
      version: 2,
      changes: { status: "완료" },
    });
    await reconcile(uid);
    expect(
      (await jobs.get()).docs.every((d) => d.data().status === "cancelled"),
    ).toBe(true);
  });
  it("soft deletes/restores, audits only committed writes and returns bounded history", async () => {
    const { item } = await call("moru_create_task", {
      requestId: randomUUID(),
      data: { title: "복구 확인", category: "생활" },
    });
    await call("moru_update_task", {
      requestId: randomUUID(),
      id: item.id,
      version: 1,
      changes: { deleted: true },
    });
    expect((await call("moru_get_task", { id: item.id })).item.deleted).toBe(
      true,
    );
    expect(
      (
        await call("moru_update_task", {
          requestId: randomUUID(),
          id: item.id,
          version: 2,
          changes: { deleted: false },
        })
      ).item.deleted,
    ).toBe(false);
    const failedId = randomUUID();
    expect(
      (
        await POST(
          bridge("moru_update_task", {
            requestId: failedId,
            id: item.id,
            version: 1,
            changes: { notes: "stale" },
          }),
        )
      ).status,
    ).toBe(409);
    expect(
      (await admin().db.doc(`privateDots/${uid}/operations/${failedId}`).get())
        .exists,
    ).toBe(false);
    const status = await (await connectionGET(connection())).json();
    expect(status.history.length).toBeLessThanOrEqual(10);
    expect(status.history.length).toBeGreaterThan(0);
    expect(JSON.stringify(status)).not.toContain(secret);
  });
  it("paginates without duplicates and protects private connection records with Rules", async () => {
    for (let i = 0; i < 52; i++)
      await saveEntity(
        uid,
        "tasks",
        `paging-${i}`,
        { ...blankTask, title: `Page ${i}` },
        0,
      );
    const a = await call("moru_list_tasks"),
      b = await call("moru_list_tasks", { cursor: a.cursor });
    expect(a.items).toHaveLength(50);
    expect(new Set([...a.items, ...b.items].map((x: any) => x.id)).size).toBe(
      a.items.length + b.items.length,
    );
    for (const actor of [uid, "dots-stranger"]) {
      const firestore = env.authenticatedContext(actor).firestore();
      await assertFails(getDoc(doc(firestore, `privateDots/${uid}`)));
      await assertFails(
        setDoc(doc(firestore, `privateDots/${uid}`), {
          enabled: true,
          uid: actor,
        }),
      );
      await assertFails(
        getDoc(doc(firestore, `privateDots/${uid}/operations/anything`)),
      );
    }
  });
  it("revokes access immediately and rejects disabled or changed owners", async () => {
    await connectionPOST(connection(false));
    expect((await POST(bridge("moru_context"))).status).toBe(403);
    await setDotsAccess(uid, true);
    await admin().auth.updateUser(uid, { disabled: true });
    expect((await POST(bridge("moru_context"))).status).toBe(403);
    await admin().auth.updateUser(uid, { disabled: false });
    await admin().db.doc("access/owner").set({ uid: "someone-else" });
    expect((await POST(bridge("moru_context"))).status).toBe(403);
    await admin().db.doc("access/owner").set({ uid });
  });
});
