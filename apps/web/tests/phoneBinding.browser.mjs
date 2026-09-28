import assert from 'node:assert/strict';
import { once } from 'node:events';
import { resolve } from 'node:path';
import express from 'express';
import { chromium, expect } from '@playwright/test';

const app = express();
const dist = resolve('apps/web/dist');
app.use(express.static(dist));
app.get('*', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === '1' ? undefined : 'msedge', headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const errors = [];
  const consoleErrors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().startsWith("EventSource's response")) consoleErrors.push(message.text());
  });
  const user = { id: 'legacy-user', username: 'old-account', nickname: '老用户', bio: '', avatar: null,
    role: 'user', createdAt: new Date().toISOString(), level: 1, equippedBadge: null,
    vipGrowthValue: 0, vipLevel: 0, vipActive: false };
  let signedIn = false;
  let bound = false;
  let sent = 0;
  let upgraded = 0;
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') return route.fulfill({ json: { user: signedIn ? user : null } });
    if (path === '/api/auth/login') {
      assert.deepEqual(JSON.parse(route.request().postData()), {
        loginType: 'legacy', identifier: 'old-account', password: 'old-password',
      });
      signedIn = true;
      return route.fulfill({ json: { user, token: 'test-token' } });
    }
    if (path === '/api/messages/unread-counts') return route.fulfill({ json: { counts: {
      system: 0, interactions: 0, requests: 0, notices: 0, privateMessages: 0,
      circleMessages: 0, circleMentions: 0, circleUnclaimedRedPackets: 0,
      circleUnclaimedRedPacketNextExpiryAt: null, total: 0,
    } } });
    if (path === '/api/me/profile-backgrounds') return route.fulfill({ json: {
      cards: [], total: 0, selectedCardId: null, crop: { x: 50, y: 50, zoom: 1 },
    } });
    if (path === '/api/auth/phone/status') return route.fulfill({ json: {
      bound, phone: bound ? '138****1234' : null, legacyLoginEnabled: !bound,
      superAdminExempt: user.role === 'super_admin',
    } });
    if (path === '/api/auth/phone/code') {
      assert.deepEqual(JSON.parse(route.request().postData()), { phone: '13800111234', purpose: 'upgrade' });
      sent++;
      return route.fulfill({ json: { ok: true, expiresInSeconds: 600, resendAfterSeconds: 60 } });
    }
    if (path === '/api/auth/phone/upgrade') {
      assert.deepEqual(JSON.parse(route.request().postData()), {
        phone: '13800111234', code: '123456', newPassword: 'new-password-123',
      });
      upgraded++;
      bound = true;
      return route.fulfill({ json: { user, token: 'test-token' } });
    }
    return route.fulfill({ json: { items: [], unlocks: [], specialBadges: [], stats: {}, invitationCode: '', invitedCount: 0 } });
  });

  await page.goto(`${origin}/mine/settings`);
  await page.getByRole('button', { name: '登录', exact: true }).last().click();
  await page.getByRole('tab', { name: '原始账号登录' }).click();
  await page.getByRole('textbox', { name: '原始账号' }).fill('old-account');
  await page.locator('input[type="password"]').fill('old-password');
  await page.getByRole('button', { name: '登录', exact: true }).last().click();
  const dialog = page.getByRole('dialog', { name: '绑定手机号' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('为保护您的账号安全，请您绑定手机号')).toBeVisible();
  await dialog.getByRole('button', { name: '稍后' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: '绑定', exact: true })).toBeVisible();
  await page.reload();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '稍后' }).click();
  await page.getByRole('button', { name: '绑定', exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: '手机号' }).fill('13800111234');
  await dialog.getByRole('button', { name: '发送短信' }).click();
  await dialog.getByRole('textbox', { name: '验证码' }).fill('123456');
  await dialog.locator('input[type="password"]').nth(0).fill('new-password-123');
  await dialog.locator('input[type="password"]').nth(1).fill('new-password-123');
  await dialog.getByRole('button', { name: '确定' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('138****1234')).toBeVisible();
  await page.reload();
  await expect(dialog).toHaveCount(0);
  assert.equal(sent, 1);
  assert.equal(upgraded, 1);

  bound = false;
  user.role = 'super_admin';
  await page.reload();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('超级管理员无需绑定')).toBeVisible();
  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, []);
  console.log('PASS phone binding: initial and repeat prompt, later, settings reopen, bind, superadmin exemption');
} finally {
  await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
