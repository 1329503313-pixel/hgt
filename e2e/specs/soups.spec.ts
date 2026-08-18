import { expect, test } from "@playwright/test";
import { createSoupViaApi, dismissBadgeUnlocks, loginAsE2eAdmin, logoutViaApi, registerViaApi } from "../helpers";

test("首页分类使用独立路由并在详情返回时保持原分类", async ({ page }) => {
  await loginAsE2eAdmin(page);
  const soup = await createSoupViaApi(page, `分类路由汤${Date.now().toString(36)}`);

  await page.goto("/");
  await page.getByText("恭喜获得新徽章！", { exact: true })
    .waitFor({ state: "visible", timeout: 5_000 })
    .catch(() => undefined);
  await dismissBadgeUnlocks(page);
  const routeCases = [
    { label: "最新", path: "/home/latest" },
    { label: "关注", path: "/home/following" },
    { label: "AI", path: "/home/ai" },
    { label: "玩过", path: "/home/played" },
    { label: "推荐", path: "/" }
  ];
  for (const routeCase of routeCases) {
    await page.getByRole("tab", { name: routeCase.label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${routeCase.path === "/" ? "/$" : `${routeCase.path}$`}`));
    await expect(page.getByRole("tab", { name: routeCase.label, exact: true })).toHaveAttribute("aria-selected", "true");
  }

  await page.getByRole("tab", { name: "最新", exact: true }).click();
  await expect(page).toHaveURL(/\/home\/latest$/);
  const soupCard = page.locator("article.soup-card:visible").filter({ hasText: soup.title }).first();
  await expect(soupCard).toBeVisible();
  await soupCard.click();
  await expect(page).toHaveURL(new RegExp(`/soup/${soup.id}$`));

  await page.getByRole("button", { name: "返回", exact: true }).first().click();
  await expect(page).toHaveURL(/\/home\/latest$/);
  await expect(page.getByRole("tab", { name: "最新", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("article.soup-card:visible").filter({ hasText: soup.title }).first()).toBeVisible();
});

test("用户可以发布并编辑海龟汤", async ({ page }) => {
  await loginAsE2eAdmin(page);
  const title = `回归汤${Date.now().toString(36)}`;
  const updatedTitle = `${title}改`;
  await page.goto("/");
  await page.locator("button:visible").filter({ hasText: /^发布海龟汤$/ }).first().click();
  await page.getByPlaceholder("请输入标题").fill(title);
  await page.getByPlaceholder("最多 40 个字").fill("自动化发布与编辑回归");
  await page.getByPlaceholder("请输入汤面").fill("一个人回家后发现门从里面锁住了。");
  await page.getByPlaceholder("请输入汤底").fill("家人提前回家，并从屋内锁上了门。");
  await page.getByText("公开汤底和主持人手册", { exact: true }).locator("xpath=ancestor::label").getByRole("checkbox").check();
  await page.getByRole("checkbox", { name: /勾选代表同意/ }).check();
  await page.locator("form").getByRole("button", { name: "发布海龟汤", exact: true }).click();
  await expect(page).toHaveURL(/\/soup\/[^/]+$/);
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await dismissBadgeUnlocks(page);

  await page.locator("button:visible").filter({ hasText: /^编辑$/ }).first().click();
  await page.getByPlaceholder("请输入标题").fill(updatedTitle);
  await page.getByPlaceholder("请输入汤面").fill("修改后的汤面内容。");
  await page.locator("form").getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByRole("heading", { name: updatedTitle, exact: true })).toBeVisible();
  await expect(page.getByText("修改后的汤面内容。", { exact: true })).toBeVisible();
});

test("点赞、收藏和评价在刷新后保持", async ({ page }) => {
  await loginAsE2eAdmin(page);
  const soup = await createSoupViaApi(page, `互动汤${Date.now().toString(36)}`);
  await logoutViaApi(page);
  await registerViaApi(page, "互动");
  await page.goto(`/soup/${soup.id}`);

  const like = page.locator("button.detail-interaction-button").filter({ hasText: /^点赞/ });
  const favorite = page.locator("button.detail-interaction-button").filter({ hasText: /^收藏/ });
  await like.click();
  await favorite.click();
  await expect(like).toHaveAttribute("aria-pressed", "true");
  await expect(favorite).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: /添加评价/ }).click();
  await page.getByPlaceholder("1-5").fill("4.5");
  await page.getByPlaceholder(/说说你对这条海龟汤/).fill("自动化评价内容");
  await page.getByRole("button", { name: "保存评价" }).click();
  await expect(page.getByText("自动化评价内容", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.locator("button.detail-interaction-button").filter({ hasText: /^点赞/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("button.detail-interaction-button").filter({ hasText: /^收藏/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("自动化评价内容", { exact: true })).toBeVisible();
});
