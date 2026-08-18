import { expect, test } from "@playwright/test";
import { uniqueAccount } from "../helpers";

test("用户可以注册、退出并重新登录", async ({ page }) => {
  const account = uniqueAccount("认证");
  await page.goto("/");
  await page.locator("button:visible").filter({ hasText: /^登录$/ }).first().click();
  await page.getByRole("button", { name: "没有账号，去注册" }).click();
  const registerForm = page.locator("form");
  await registerForm.locator('input[name="nickname"]').fill(account.nickname);
  await registerForm.locator('input[name="username"]').fill(account.username);
  await registerForm.locator('input[name="password"]').fill(account.password);
  await page.getByRole("button", { name: "注册并登录" }).click();
  await expect(page.getByRole("heading", { name: "注册" })).toBeHidden();

  const registered = await page.evaluate(async () => (await fetch("/api/auth/me")).json());
  expect(registered.user?.username).toBe(account.username);

  await page.context().request.post("/api/auth/logout");
  await page.reload();
  await page.locator("button:visible").filter({ hasText: /^登录$/ }).first().click();
  const loginForm = page.locator("form");
  await loginForm.locator('input[name="username"]').fill(account.username);
  await loginForm.locator('input[name="password"]').fill(account.password);
  await loginForm.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "登录" })).toBeHidden();
  const loggedIn = await page.evaluate(async () => (await fetch("/api/auth/me")).json());
  expect(loggedIn.user?.username).toBe(account.username);
});
