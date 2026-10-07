import { test, expect } from "@playwright/test";
test("desktop CRUD, reload, candidate plans and disconnected integrations", async ({
  page,
}) => {
  const title = "테스트 · 마감과 실행 분리 " + Date.now();
  const planTitle = "테스트 후보 계획 " + Date.now();
  await page.goto("/");
  await page.getByRole("button", { name: "로컬 테스트 계정으로 시작" }).click();
  await expect(
    page.getByRole("heading", { name: "오늘, 한 걸음." }),
  ).toBeVisible();
  await expect(
    page.getByText("프로젝트 소개 문장 다듬기", { exact: true }).first(),
  ).toBeVisible();
  await page.screenshot({ path: "screenshots/desktop.png", fullPage: true });
  await page.getByRole("button", { name: "할 일 추가", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("제목", { exact: false })
    .fill(title);
  await page.getByLabel("마감일 · 날짜만").fill("2026-11-20");
  await page.getByRole("button", { name: "저장하기" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "모든 할 일", exact: true }).click();
  await page.getByRole("button", { name: title + " 완료" }).click();
  await page.getByRole("button", { name: title + " 다시 열기" }).click();
  await page.getByRole("button", { name: new RegExp(title + " 학습") }).click();
  await page
    .getByRole("combobox", { name: "상태", exact: true })
    .selectOption("보류");
  await page
    .getByRole("textbox", { name: "메모", exact: true })
    .fill("새로고침 후에도 남는 메모");
  await page.getByRole("button", { name: "저장하기" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "모든 할 일", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(title + " 학습") }).click();
  await expect(
    page.getByRole("combobox", { name: "상태", exact: true }),
  ).toHaveValue("보류");
  await expect(
    page.getByRole("textbox", { name: "메모", exact: true }),
  ).toHaveValue("새로고침 후에도 남는 메모");
  await expect(page.getByLabel("시작", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: title + " 삭제" }).click();
  await page.getByLabel("할 일 상태 필터").selectOption("삭제됨");
  await page.getByRole("button", { name: title + " 복구" }).click();
  await page.getByLabel("할 일 상태 필터").selectOption("전체");
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "내 계획", exact: true }).click();
  await page.getByRole("button", { name: "새 계획", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("제목", { exact: false })
    .fill(planTitle);
  await page.getByRole("button", { name: "저장하기" }).click();
  await page.getByRole("button", { name: new RegExp(planTitle) }).click();
  await expect(page.getByText("학습 · 검토 중", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await expect(page.getByText("OAuth 설정 없음 · 연결되지 않음")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Google Calendar 연결", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "캘린더", exact: true }).click();
  await page.getByRole("button", { name: "Google 새로고침" }).click();
  await expect(page.locator(".error[role=alert]")).toContainText("연결");
  await page.getByRole("button", { name: "로그아웃" }).click();
  await page.getByRole("button", { name: "로컬 테스트 계정으로 시작" }).click();
  await page.getByRole("button", { name: "모든 할 일", exact: true }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
});
test("mobile 390px: navigation, long text editor and calendar remain usable", async ({
  page,
}) => {
  const title = "테스트 · 마감과 실행 분리 " + Date.now();
  const planTitle = "테스트 후보 계획 " + Date.now();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "로컬 테스트 계정으로 시작" }).click();
  await expect(
    page.getByRole("heading", { name: "오늘, 한 걸음." }),
  ).toBeVisible();
  await expect(
    page.getByText("프로젝트 소개 문장 다듬기", { exact: true }).first(),
  ).toBeVisible();
  await page.screenshot({ path: "screenshots/mobile.png", fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "할 일 추가", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("제목", { exact: false })
    .fill("긴 제목도 안전하게 표시되는지 확인하는 작은 테스트 ".repeat(3));
  await page
    .getByRole("textbox", { name: "메모", exact: true })
    .fill("긴 메모 ".repeat(100));
  await page.getByRole("button", { name: "저장하기" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "캘린더", exact: true }).click();
  await expect(page.getByRole("heading", { name: "시간 미정" })).toBeVisible();
  await page.getByRole("button", { name: "주간", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "screenshots/mobile-calendar.png",
    fullPage: true,
  });
});
