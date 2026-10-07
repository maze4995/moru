import { admin } from "../src/server/firebase";
import { saveEntity, saveSettings } from "../src/server/repository";
import { blankTask, blankPlan } from "../src/domain/model";
import { DateTime } from "luxon";
if (
  process.env.FIREBASE_PROJECT_ID !== "demo-moru" ||
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
)
  throw new Error("Seed is emulator-only");
const { db, auth } = admin(),
  uid = "local-owner";
try {
  await auth.getUser(uid);
} catch {
  await auth.createUser({
    uid,
    email: "owner@example.test",
    emailVerified: true,
    password: "moru-local-only",
    displayName: "나의 공간",
  });
}
await db.doc("access/owner").set({ uid });
await saveSettings(uid, { timezone: "Asia/Seoul", emailEnabled: false });
if (!(await db.doc(`users/${uid}/plans/example-study`).get()).exists) {
  const now = DateTime.now().setZone("Asia/Seoul");
  await saveEntity(
    uid,
    "plans",
    "example-study",
    {
      ...blankPlan,
      title: "나만의 포트폴리오 완성하기",
      category: "개인 프로젝트",
      status: "진행 중",
      goal: "작은 프로젝트를 완성하고 배운 내용을 정리하기",
      targetDate: now.plus({ days: 14 }).toISODate(),
      notes: "가상 예시입니다. 자유롭게 수정하거나 삭제하세요.",
    },
    0,
  );
  await saveEntity(
    uid,
    "plans",
    "example-candidate",
    {
      ...blankPlan,
      title: "관심 있는 자격시험 살펴보기",
      category: "자격증",
      goal: "응시 여부를 결정하기 전 정보를 모으는 후보",
      notes: "가상 예시 · 아직 확정된 일정이 아닙니다",
    },
    0,
  );
  for (const [id, title, day, priority, planId, category, start] of [
    [
      "example-1",
      "프로젝트 소개 문장 다듬기",
      0,
      "높음",
      "example-study",
      "개인 프로젝트",
      14,
    ],
    ["example-2", "관심 공고 지원 마감 확인", 3, "높음", null, "취업", null],
    ["example-3", "지난 학습 내용 20분 복습", -1, "보통", null, "학습", null],
    ["example-4", "이번 주 생활 계획 정리", 0, "낮음", null, "생활", null],
  ] as const) {
    await saveEntity(
      uid,
      "tasks",
      id,
      {
        ...blankTask,
        title,
        category,
        planId,
        priority,
        dueDate: now.plus({ days: day }).toISODate(),
        startAt: start
          ? now
              .set({ hour: start, minute: 0, second: 0, millisecond: 0 })
              .toUTC()
              .toISO()
          : null,
        endAt: start
          ? now
              .set({ hour: start + 1, minute: 0, second: 0, millisecond: 0 })
              .toUTC()
              .toISO()
          : null,
        notes: "가상 예시 데이터",
      },
      0,
    );
  }
}
console.log(
  "Emulator ready. Local test account: owner@example.test / moru-local-only (fictional data only).",
);
