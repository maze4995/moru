import { test, expect, type Page, type Locator } from "@playwright/test";

async function fitsScreen(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
async function visibleControl(locator: Locator, page: Page) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(
    page.viewportSize()!.height + 1,
  );
}

for (const width of [320, 390, 430]) {
  test(`mobile ${width}: touch navigation, editing, retry and month boundary`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 844 });
    await page.clock.setFixedTime(new Date("2026-10-01T03:00:00Z"));
    await page.goto("/");
    await page
      .getByRole("button", { name: "로컬 테스트 계정으로 시작" })
      .click();
    await expect(
      page.getByRole("heading", { name: "오늘, 한 걸음." }),
    ).toBeVisible();
    const nav = page.getByRole("navigation", { name: "주 메뉴" });
    await fitsScreen(page);
    for (const button of await nav.getByRole("button").all())
      await visibleControl(button, page);
    await page.screenshot({
      path: `screenshots/mobile-${width}-today.png`,
      fullPage: true,
    });

    const title = `모바일 검증 ${width} ${Date.now()} 긴제목표시확인`.repeat(2);
    await page.getByLabel("빠른 할 일 제목").fill(title);
    await page
      .locator(".quick-add")
      .getByRole("button", { name: "추가" })
      .click();
    const row = page
      .locator(".task-row")
      .filter({ has: page.getByText(title, { exact: true }) })
      .first();
    await expect(row).toBeVisible();
    await row
      .getByRole("button", { name: `${title} 완료`, exact: true })
      .click();
    await nav.getByRole("button", { name: "모든 할 일", exact: true }).click();
    await page
      .getByRole("button", { name: `${title} 다시 열기`, exact: true })
      .click();
    await row.locator(".task-main").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("마감일 · 날짜만").fill("2026-10-01");
    await dialog.getByLabel("시작", { exact: true }).fill("2026-10-02T10:00");
    await dialog.getByLabel("종료", { exact: true }).fill("2026-10-02T11:00");
    await dialog
      .getByRole("textbox", { name: "메모", exact: true })
      .fill("긴 메모와 줄바꿈\n".repeat(100));
    await page.setViewportSize({ width, height: 480 });
    await visibleControl(
      dialog.getByRole("button", { name: "저장하기" }),
      page,
    );
    await visibleControl(
      dialog.getByRole("button", { name: "닫기", exact: true }),
      page,
    );
    await fitsScreen(page);
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({ path: `screenshots/mobile-${width}-editor.png` });

    await page.route("**/api/data", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "테스트 저장 실패 · 다시 시도하세요" }),
        });
      } else await route.continue();
    });
    await dialog.getByRole("button", { name: "저장하기" }).click();
    await expect(dialog.getByRole("alert")).toContainText("테스트 저장 실패");
    await visibleControl(
      dialog.getByRole("button", { name: "저장하기" }),
      page,
    );
    await page.unroute("**/api/data");
    await dialog.getByRole("button", { name: "저장하기" }).click();
    await expect(dialog).not.toBeVisible();
    await page.setViewportSize({ width, height: 844 });
    await page.reload();
    await nav.getByRole("button", { name: "캘린더", exact: true }).click();
    const picker = page.getByRole("group", { name: "월간 날짜 선택" });
    await picker.getByRole("button", { name: /^10월 1일 ·/ }).click();
    await expect(
      page.locator(".day:visible .deadline-event").filter({ hasText: title }),
    ).toBeVisible();
    await expect(
      page.locator(".day:visible .app-event").filter({ hasText: title }),
    ).toHaveCount(0);
    await picker.getByRole("button", { name: /^10월 2일 ·/ }).click();
    await expect(
      page.locator(".day:visible .app-event").filter({ hasText: title }),
    ).toBeVisible();
    await fitsScreen(page);
    await page.screenshot({
      path: `screenshots/mobile-${width}-month.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "주간", exact: true }).click();
    await expect(page.locator(".calendar-days .day:visible")).toHaveCount(7);
    await expect(
      page.getByRole("region", { name: "2026년 9월 28일", exact: true }),
    ).toBeVisible();
    await fitsScreen(page);
    await page.screenshot({
      path: `screenshots/mobile-${width}-week.png`,
      fullPage: true,
    });
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    await visibleControl(
      nav.getByRole("button", { name: "내 계획", exact: true }),
      page,
    );
    for (const name of ["내 계획", "알림함", "설정"]) {
      await nav.getByRole("button", { name, exact: true }).click();
      expect(await page.evaluate(() => scrollY)).toBe(0);
      await fitsScreen(page);
    }
    await nav.getByRole("button", { name: "모든 할 일", exact: true }).click();
    page.once("dialog", (d) => d.accept());
    await page
      .getByRole("button", { name: `${title} 삭제`, exact: true })
      .click();
    await expect(page.getByText(title, { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "로그아웃", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "로컬 테스트 계정으로 시작" }),
    ).toBeVisible();
  });
}
