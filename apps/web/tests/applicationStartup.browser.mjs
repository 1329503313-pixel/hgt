// Load the real Vite entry and lazy chunks; never replace React providers or getUserMedia.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { once } from 'node:events';
import express from 'express';
import { chromium, expect } from '@playwright/test';
import { securityHeaders } from '../../server/src/securityHeaders.ts';

const androidOnly = process.argv.includes('--android-only');
const profiles = androidOnly ? ['android'] : ['web', 'wechat', 'android'];
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === '1' ? undefined : 'msedge',
  headless: true,
  args: ['--use-fake-device-for-media-stream']
});
try {
  for (const profile of profiles) {
    const dist = resolve(profile === 'android'
      ? (process.env.HGT_STARTUP_ANDROID_DIST || 'apps/web/dist-android') : 'apps/web/dist');
    assert.ok(existsSync(resolve(dist, 'index.html')), `Build ${profile} before running this gate`);
    const app = express();
    app.use(securityHeaders);
    // Negative control proves that the old production policy really blocks capture.
    app.get('/blocked-microphone', (_req, res) => {
      res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
      res.send('<!doctype html><title>Blocked microphone control</title>');
    });
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const context = await browser.newContext({
      viewport: { width: profile === 'web' ? 1280 : 390, height: 844 },
      serviceWorkers: 'block',
      ...(profile === 'wechat' ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.54' } : {})
    });
    try {
      await context.grantPermissions(['microphone'], { origin });
      const page = await context.newPage();
      const errors = [];
      const failedScripts = [];
      page.on('pageerror', error => { errors.push(error.message); console.error(`${profile} pageerror: ${error.message}`); });
      page.on('requestfailed', request => { if (request.resourceType() === 'script') failedScripts.push(request.url()); });
      // Only network fixtures: the application, providers, routes and platform imports are real.
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.pathname.startsWith('/api/')) {
          const payload = url.pathname === '/api/auth/me' ? { user: null } : {
            items: [], soups: [], banners: [], notices: [], categories: [], topics: [],
            rooms: [], total: 0, hasMore: false, nextCursor: null, enabled: false
          };
          return route.fulfill({ json: payload });
        }
        return url.origin === origin ? route.continue() : route.abort();
      });
      const response = await page.goto(`${origin}/mine`);
      assert.equal(response.headers()['permissions-policy'], 'camera=(), microphone=(self), geolocation=()');
      await expect(page.getByText('登录后查看个人主页', { exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByText('登录后查看个人主页', { exact: true })).toBeVisible();
      await page.goto(origin);
      await expect(page.locator('#root')).toContainText('汤物语');
      await expect(page.getByRole('tablist', { name: '首页内容分类' })).toBeVisible();
      await expect(page.getByText('页面出错了', { exact: true })).toHaveCount(0);
      assert.deepEqual(errors, [], `${profile}: uncaught application error`);
      assert.deepEqual(failedScripts, [], `${profile}: a production chunk failed to load`);
      assert.equal(await page.locator('html').evaluate(el => el.classList.contains('android-app')), profile === 'android');
      if (profile === 'wechat') assert.equal(await page.locator('html').evaluate(el => el.classList.contains('wechat-webview')), true);

      // Real browser permission enforcement and fake hardware; no getUserMedia stubs.
      const capture = await page.evaluate(async () => {
        const policy = document.permissionsPolicy || document.featurePolicy;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        const track = stream.getAudioTracks()[0];
        const state = track.readyState;
        stream.getTracks().forEach(item => item.stop());
        return { state, stopped: track.readyState, mic: policy.allowsFeature('microphone'), camera: policy.allowsFeature('camera'), location: policy.allowsFeature('geolocation') };
      });
      assert.deepEqual(capture, { state: 'live', stopped: 'ended', mic: true, camera: false, location: false });
      await page.goto(`${origin}/blocked-microphone`);
      const blocked = await page.evaluate(async () => {
        try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach(t => t.stop()); return 'unexpected capture'; }
        catch (error) { return error.name; }
      });
      assert.equal(blocked, 'NotAllowedError');
      await context.clearPermissions();
      await page.goto(`${origin}/mine`);
      const denied = await page.evaluate(async () => {
        try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach(t => t.stop()); return 'unexpected capture'; }
        catch (error) { return error.name; }
      });
      assert.equal(denied, 'NotAllowedError', 'Same-origin policy must not bypass user consent');
      console.log(`PASS ${profile}: production startup/reload/home, microphone capture/stop, blocked-policy and user-denial controls`);
    } finally {
      await context.close();
      await new Promise(resolveClose => server.close(resolveClose));
    }
  }
} finally { await browser.close(); }
