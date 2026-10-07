import { test, expect } from "@playwright/test";
test("dots stays disconnected until configured and errors do not block planning", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "로컬 테스트 계정으로 시작" }).click();
  await expect(
    page.getByRole("heading", { name: "오늘, 한 걸음." }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "설정", exact: true })
    .click();
  await expect(
    page.getByText("연결 준비 필요 · 접근 꺼짐", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "dots 접근 허용", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("heading", { name: "dots · 모루 연결" })
    .scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "screenshots/dots-mobile-settings.png" });
  await page.route("**/api/dots/connection", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "테스트 연결 오류" }),
    }),
  );
  await page.getByRole("button", { name: "연결 상태·기록 새로고침" }).click();
  await expect(
    page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "dots · 모루 연결" }) })
      .getByRole("alert"),
  ).toContainText("테스트 연결 오류");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "오늘", exact: true })
    .click();
  await page.getByRole("button", { name: "할 일 추가", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "닫기", exact: true })
    .click();
});
