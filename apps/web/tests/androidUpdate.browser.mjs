import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

// Exercise the real React gate and Modal with a controllable native bridge.
const bundle = await build({
  stdin: { resolveDir: resolve('apps/web'), loader: 'tsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { AndroidUpdateGate } from './src/components/AndroidUpdateGate';
    import { closeTopAndroidLayer } from './src/android/backStack';
    window.back = closeTopAndroidLayer;
    window.root = createRoot(document.getElementById('root'));
    window.mount = () => window.root.render(<React.StrictMode><AndroidUpdateGate /></React.StrictMode>);
    window.mount();
  ` },
  bundle: true, write: false, format: 'iife', define: { 'import.meta.env': '{"VITE_HGT_TARGET":"android"}' },
  plugins: [{ name: 'native-bridge', setup(build) {
    build.onLoad({ filter: /[\\/]android[\\/]platform\.ts$/ }, () => ({ loader: 'js', contents: `
      export const IS_NATIVE_ANDROID = true;
      export async function getAndroidUpdate() { window.checks++; return window.manifest; }
      export async function getAndroidDownloadStatus() {
        if (window.statusError) throw new Error(window.statusError);
        if (window.holdStatus) { const snapshot = {...window.download}; await new Promise(r => window.releaseStatus = r); return snapshot; }
        return window.legacy ? null : {...window.download};
      }
      export async function downloadAndInstallAndroidUpdate() {
        window.starts++;
        if (window.holdDownload) await new Promise(r => window.releaseDownload = r);
        if (window.startError) throw new Error(window.startError);
        window.download = {status: 'downloading', received: 1024, total: 4096};
        return window.legacy ? {downloadId: '1'} : {...window.download};
      }
      export async function installDownloadedAndroidUpdate() {
        window.installs++;
        if (window.installError) throw new Error(window.installError);
      }
      export async function openAndroidUpdateDownload() { window.browserOpens++; }
    ` }));
  } }]
});
const assetDir = resolve('apps/web/dist/assets');
const css = readFileSync(resolve(assetDir, readdirSync(assetDir).find(n => n.startsWith('index-') && n.endsWith('.css'))), 'utf8');
const output = resolve('artifacts/android-update');
mkdirSync(output, {recursive: true});
const browser = await chromium.launch({channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === '1' ? undefined : 'msedge', headless: true});
const failures = [];
async function newPage(options = {}) {
  const page = await browser.newPage({viewport: {width: 375, height: 812}, reducedMotion: 'reduce'});
  page.on('pageerror', error => failures.push(error.message));
  await page.route('**/*', route => route.abort());
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({content: css});
  await page.evaluate(options => Object.assign(window, {
    manifest: {updateAvailable: true, latestVersionName: '测试版本', apkUrl: 'https://zgkc-storage.kjcxchina.com/hgt/apps/test.apk', releaseNotes: ['修复下载后安装页未打开的问题'], forceUpdate: !!options.force},
    checks: 0, starts: 0, installs: 0, browserOpens: 0,
    download: options.download || {status: 'none'}, legacy: !!options.legacy,
    resume: () => window.dispatchEvent(new CustomEvent('hgt:app-state', {detail: {isActive: true}}))
  }), options);
  await page.addScriptTag({content: bundle.outputFiles[0].text});
  await expect(page.getByRole('alertdialog')).toBeVisible();
  return page;
}
try {
  const page = await newPage();
  await page.evaluate(() => window.holdDownload = true);
  await page.getByRole('button', {name: '立即更新', exact: true}).click();
  await expect(page.getByText('正在处理，请稍候…')).toBeVisible();
  await expect(page.getByRole('button', {name: '立即更新', exact: true})).toBeDisabled();
  await page.evaluate(() => window.resume());
  assert.equal(await page.evaluate(() => window.checks), 1, 'resume must not replace an active update');
  await page.evaluate(() => window.releaseDownload());
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
  await page.evaluate(() => { window.download = {status: 'ready'}; window.resume(); });
  await expect(page.getByRole('button', {name: '安装更新', exact: true})).toBeVisible();
  assert.equal(await page.evaluate(() => window.installs), 0, 'completion waits for a foreground user action');
  await page.evaluate(() => window.installError = '请允许汤物语安装未知应用，返回后点击安装更新');
  await page.getByRole('button', {name: '安装更新', exact: true}).click();
  await expect(page.getByRole('status')).toContainText('安装未知应用');
  await page.evaluate(() => { window.installError = null; window.resume(); });
  await page.getByRole('button', {name: '安装更新', exact: true}).click();
  await expect(page.getByRole('status')).toContainText('已请求打开系统安装页');
  await page.evaluate(() => window.resume());
  await page.getByRole('button', {name: '安装更新', exact: true}).click();
  assert.equal(await page.evaluate(() => window.installs), 3, 'permission return / cancelled installer remains retryable');
  assert.equal(await page.evaluate(() => window.starts), 1, 'install retry does not download again');
  for (const [name, width, height] of [['mobile', 375, 812], ['landscape', 812, 375], ['large', 1440, 900]]) {
    await page.setViewportSize({width, height});
    await page.screenshot({path: resolve(output, name + '.png')});
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
  }
  await page.addStyleTag({content: 'html {font-size: 24px}'});
  await page.getByRole('button', {name: '安装更新', exact: true}).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', {name: '安装更新', exact: true})).toBeVisible();
  await page.close();

  const paused = await newPage({download: {status: 'paused', message: '系统正在等待 Wi-Fi，请连接 Wi-Fi 后继续'}});
  await expect(paused.getByText('系统正在等待 Wi-Fi，请连接 Wi-Fi 后继续')).toBeVisible();
  await paused.evaluate(() => { window.download = {status: 'failed', message: '存储空间不足，请清理空间后重试'}; window.resume(); });
  await expect(paused.getByRole('status')).toContainText('存储空间不足');
  await paused.getByRole('button', {name: '重新下载', exact: true}).click();
  await expect(paused.getByRole('progressbar')).toBeVisible();
  await paused.evaluate(() => window.statusError = '无法读取系统下载状态，请稍后重试');
  await paused.evaluate(() => window.resume());
  await expect(paused.getByRole('status')).toContainText('无法读取系统下载状态');
  await paused.getByRole('button', {name: '通过浏览器下载安装'}).click();
  assert.equal(await paused.evaluate(() => window.browserOpens), 1);
  await paused.close();

  const forced = await newPage({force: true, download: {status: 'ready'}});
  await expect(forced.getByRole('button', {name: '稍后', exact: true})).toHaveCount(0);
  await forced.evaluate(() => window.back());
  await expect(forced.getByRole('alertdialog')).toBeVisible();
  await forced.close();

  const legacy = await newPage({legacy: true});
  await legacy.getByRole('button', {name: '立即更新', exact: true}).click();
  await expect(legacy.getByRole('status')).toContainText('下载已交给系统处理');
  await expect(legacy.getByRole('button', {name: '通过浏览器下载安装'})).toBeEnabled();
  await legacy.close();

  const timeout = await newPage();
  await timeout.clock.install();
  await timeout.evaluate(() => window.holdDownload = true);
  await timeout.getByRole('button', {name: '立即更新', exact: true}).click();
  await timeout.clock.fastForward(16000);
  await expect(timeout.getByRole('status')).toContainText('系统响应超时');
  await expect(timeout.getByRole('button', {name: '立即更新', exact: true})).toBeEnabled();
  await timeout.close();

  const rejected = await newPage();
  await rejected.clock.install();
  await rejected.evaluate(() => window.startError = '系统下载管理器已停用，请启用后重试');
  await rejected.getByRole('button', {name: '立即更新', exact: true}).click();
  await rejected.clock.fastForward(4000);
  await expect(rejected.getByRole('status')).toContainText('系统下载管理器已停用');
  await rejected.close();

  const stale = await newPage();
  await stale.evaluate(() => { window.holdStatus = true; window.resume(); });
  await expect.poll(() => stale.evaluate(() => typeof window.releaseStatus)).toBe('function');
  await stale.getByRole('button', {name: '立即更新', exact: true}).click();
  await stale.evaluate(() => { window.holdStatus = false; window.releaseStatus(); });
  await expect(stale.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
  await stale.close();
  assert.deepEqual(failures, []);
  console.log('Android update browser regressions passed: progress, permission return, install retry, resume, pause/failure, fallback, forced gate, legacy shell, timeout and responsive layouts.');
} finally {
  await browser.close();
}
