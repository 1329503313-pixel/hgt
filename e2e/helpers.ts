import { expect, type Page } from "@playwright/test";

let sequence = 0;

export function uniqueAccount(prefix: string) {
  sequence += 1;
  const suffix = `${Date.now().toString(36)}${sequence.toString(36)}`;
  return {
    username: `${prefix}_${suffix}`.slice(0, 40),
    password: "E2e-pass-2026!",
    nickname: `${prefix}${sequence}`.slice(0, 8)
  };
}

export async function registerViaApi(page: Page, prefix = "测试用户") {
  const account = uniqueAccount(prefix);
  const response = await page.context().request.post("/api/auth/register", { data: account });
  expect(response.ok(), await response.text()).toBeTruthy();
  return account;
}

export async function loginAsE2eAdmin(page: Page) {
  const response = await page.context().request.post("/api/auth/login", {
    data: { username: "admin", password: "Hgt-E2E-Admin-2026!" }
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

export async function logoutViaApi(page: Page) {
  const response = await page.context().request.post("/api/auth/logout");
  expect(response.ok(), await response.text()).toBeTruthy();
}

export async function dismissBadgeUnlocks(page: Page) {
  const heading = page.getByText("恭喜获得新徽章！", { exact: true });
  for (let index = 0; index < 8; index += 1) {
    if (!(await heading.isVisible().catch(() => false))) return;
    // The overlay intentionally closes only when its dimmed backdrop is clicked.
    await page.mouse.click(8, Math.floor(page.viewportSize()?.height ?? 800) / 2);
    await page.waitForTimeout(900);
  }
  await expect(heading).toBeHidden();
}

export async function createSoupViaApi(page: Page, title: string) {
  const response = await page.context().request.post("/api/soups", {
    headers: { "Idempotency-Key": `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}` },
    data: {
      title,
      author: "自动化作者",
      type: "本格清汤",
      difficulty: "普通",
      summary: "自动化回归测试作品",
      coverImage: "",
      isOriginal: true,
      isSensitive: false,
      surface: "测试汤面：房间里发生了一件奇怪的事。",
      supplementalSurfaces: [],
      bottom: "测试汤底：这是一条用于自动化回归的答案。",
      supplementalBottoms: [],
      manual: "按测试流程主持。",
      isSurfacePublic: true,
      isBottomPublic: true,
      enableAiGame: false,
      aiPrompt: "",
      keyFacts: [],
      keyFactsCustomized: false
    }
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as { id: string };
}
