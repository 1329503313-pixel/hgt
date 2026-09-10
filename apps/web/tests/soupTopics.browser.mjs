import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';

const baseUrl = process.env.HGT_TOPIC_TEST_URL || 'http://127.0.0.1:5173';
const topic = { id: 'topic-campus', name: '校园怪谈', isActive: false };
const soup = {
  id: 'topic-soup', title: '午夜的教室', topic, author: '测试作者', creatorName: '测试作者',
  creatorId: 'creator', creatorAvatar: null, creatorLevel: 1, creatorVipLevel: 0,
  creatorVipActive: false, creatorEquippedBadge: null, type: '本格清汤', difficulty: '普通',
  summary: '每天午夜都会亮起的灯，究竟是谁打开的？', coverImage: null, isOriginal: true,
  isSurfacePublic: true, isBottomPublic: true, enableAiGame: false, viewCount: 12,
  likeCount: 2, favoriteCount: 1, evaluationCount: 0, heatValue: 120, averageTotal: null,
  isLiked: false, isFavorited: false, reviewStatus: 'approved', reviewVersion: 1,
  createdAt: '2026-09-10T00:00:00.000Z', radar: {}, surface: '每天午夜教室的灯都会亮起。',
  supplementalSurfaces: [], supplementalBottoms: [], bottom: '值班人员打开了灯。', manual: '',
  canViewFull: true, canEdit: false, evaluations: [], keyFacts: [], keyFactsCustomized: false
};
const rows = [soup, { ...soup, id: 'unbound', title: '校园怪谈同名作品', topic: null }];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
mkdirSync('artifacts/soup-topics', { recursive: true });
try {
  for (const [name, viewport] of [['desktop', { width: 1365, height: 900 }], ['mobile', { width: 375, height: 812 }]]) {
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
    const errors = [], requests = [];
    let admin = false;
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      requests.push(url);
      let data = {};
      if (url.pathname === '/api/auth/me') data = { user: admin ? { id: 'admin', username: 'admin', nickname: '管理', role: 'super_admin', level: 1, vipLevel: 0 } : null };
      else if (url.pathname === '/api/soups') {
        const keyword = url.searchParams.get('keyword') || '';
        const filtered = rows.filter(row => keyword.startsWith('#') ? row.topic?.name === keyword.slice(1) : !keyword || row.title.includes(keyword) || row.topic?.name.includes(keyword));
        data = { soups: filtered, total: filtered.length, hasMore: false };
      } else if (url.pathname === '/api/soups/topic-soup') data = { soup };
      else if (url.pathname === '/api/banners') data = { banners: [] };
      else if (url.pathname === '/api/users/search') data = { users: [], total: 0 };
      else if (url.pathname === '/api/messages/unread-counts') data = { counts: { total: 0 } };
      else if (url.pathname.includes('platform-notifications')) data = { notifications: [] };
      else if (url.pathname.includes('soup-topics')) data = { topics: [topic] };
      else if (url.pathname.includes('badge-unlocks')) data = { badges: [], unlocked: [] };
      else if (url.pathname.endsWith('/shells')) data = { balance: 0 };
      await route.fulfill({ json: data });
    });
    await page.goto(baseUrl);
    const link = page.getByRole('link', { name: '搜索话题：校园怪谈' });
    await expect(link).toHaveCount(1);
    await expect(link).toBeVisible();
    assert.equal(await link.evaluate(e => getComputedStyle(e).fontSize), '12px');
    await page.screenshot({ path: `artifacts/soup-topics/${name}-home.png` });
    await link.click();
    await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('#校园怪谈');
    await expect(page.locator('.soup-card:visible')).toHaveCount(1);
    assert(!requests.some(url => url.pathname === '/api/soups/topic-soup'), 'topic click must not open soup');
    assert(!requests.some(url => url.pathname === '/api/users/search'), 'topic search must not search users');
    await page.reload();
    await expect(page.locator('.soup-card:visible')).toHaveCount(1);
    await page.locator('.soup-card:visible h2').getByText('午夜的教室', { exact: false }).first().click({ position: { x: 8, y: 8 } });
    await expect(page.locator('h1')).toContainText('午夜的教室');
    await expect(link).toBeVisible();
    await page.screenshot({ path: `artifacts/soup-topics/${name}-detail.png` });
    await link.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('#校园怪谈');
    await page.goBack();
    await expect(page.locator('h1')).toContainText('午夜的教室');
    admin = true;
    await page.goto(`${baseUrl}/admin/soups`);
    const search = page.getByRole('textbox', { name: '搜索标题、作者、话题' });
    await expect(search).toBeVisible();
    await expect(link).toBeVisible();
    await search.fill('校园怪谈');
    await search.press('Enter');
    await expect(page.getByText('共 2 条', { exact: true })).toBeVisible();
    await search.fill('#校园怪谈');
    await search.press('Enter');
    await expect(page.getByText('共 1 条', { exact: true })).toBeVisible();
    await page.screenshot({ path: `artifacts/soup-topics/${name}-admin.png` });
    await link.click();
    await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('#校园怪谈');
    assert.deepEqual(errors, []);
    console.log(`PASS ${name}: topic display, click/keyboard navigation, exact search, reload/history, admin search`);
    await page.close();
  }
} finally { await browser.close(); }
