import { expect, test } from "@playwright/test";
import { registerViaApi } from "../helpers";

test("游戏房间消息在重新进入后仍然存在", async ({ page }) => {
  await registerViaApi(page, "房主");
  const roomName = `回归房${Date.now().toString(36)}`;
  const message = `持久消息${Date.now().toString(36)}`;
  await page.goto("/online-soup");
  await page.getByRole("button", { name: "创建房间", exact: true }).first().click();
  await page.getByRole("button", { name: "海龟汤", exact: true }).click();
  await page.getByPlaceholder("例如：周五夜猫局").fill(roomName);
  await page.getByRole("button", { name: "创建并进入" }).click();
  await expect(page).toHaveURL(/\/online-soup\/rooms\/[^/]+$/);

  const input = page.getByPlaceholder("主持人发言…");
  await input.fill(message);
  await input.press("Enter");
  await expect(page.getByText(message, { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
});
