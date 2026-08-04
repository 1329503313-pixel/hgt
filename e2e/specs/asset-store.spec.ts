import { expect, test } from "@playwright/test";
import { registerViaApi } from "../helpers";

test.use({ viewport: { width: 390, height: 844 } });

test("免费抽取用尽后，商城与卡包详情保持一致", async ({ page }) => {
  await registerViaApi(page, "抽卡");
  await page.goto("/mine/store/e2e-pack");

  for (const remaining of [3, 2, 1]) {
    await page.getByRole("button", { name: `免费单抽 (${remaining})` }).click();
    const dialog = page.getByRole("dialog", { name: "抽卡结果" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "跳过动画" }).click();
    await dialog.getByRole("button", { name: "收下卡片" }).click();
    await expect(dialog).toBeHidden();
  }

  await expect(page.getByRole("button", { name: /免费单抽/ })).toHaveCount(0);
  await page.goto("/mine/store");
  await expect(page.getByText("今日免费抽取").locator("..")).toContainText("0 次");
  await page.getByRole("button", { name: /抽取卡牌/ }).click();
  await expect(page).toHaveURL(/\/mine\/store\/e2e-pack$/);
  await expect(page.getByRole("button", { name: /免费单抽/ })).toHaveCount(0);
});
