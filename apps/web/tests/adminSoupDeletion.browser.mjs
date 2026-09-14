// Local HTTP fixture: real SoupManagement + api(), including browser HTTP caching.
// Run from repository root: node apps/web/tests/adminSoupDeletion.browser.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const bundle = await build({
  stdin: { resolveDir: resolve('apps/web'), loader: 'tsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {MemoryRouter} from 'react-router-dom';
    import {SoupManagement} from './src/components/admin/SoupManagement';
    createRoot(document.getElementById('root')).render(<MemoryRouter><SoupManagement isSuperAdmin /></MemoryRouter>);
  ` },
  bundle: true, write: false, format: 'iife', jsx: 'automatic',
  define: { 'import.meta.env': '{}' },
  plugins: [{ name: 'isolate-admin-services', setup(builder) {
    builder.onLoad({ filter: /[\\/]context[\\/]AppContext\.tsx$/ }, () => ({ loader: 'js', contents: `
      const showToast = message => { document.getElementById('toast').textContent = message; };
      export function useApp(){return {showToast};}
      export const soupTypes = []; export const soupDifficulties = [];
    ` }));
    builder.onLoad({ filter: /[\\/]runtime\.ts$/ }, () => ({ loader: 'js', contents: `
      export const apiEndpoint = path => path;
      export const normalizeApiMediaUrls = data => data;
    ` }));
    builder.onLoad({ filter: /[\\/]SoupTopicManagement\.tsx$/ }, () => ({ loader: 'js', contents: 'export function SoupTopicManagement(){return null;}' }));
    builder.onLoad({ filter: /[\\/]SoupTopicLink\.tsx$/ }, () => ({ loader: 'js', contents: 'export function SoupTopicLink(){return null;}' }));
  } }],
});

const makeSoups = count => Array.from({ length: count }, (_, i) => ({
  id: String(i + 1), title: `回归汤品${i + 1}`, type: '本格清汤', difficulty: '普通',
  reviewStatus: 'approved', heatValue: 0, likeCount: 0, favoriteCount: 0,
  evaluationCount: 0, creatorName: '测试', createdAt: '2026-09-14T00:00:00Z',
}));
let soups = makeSoups(11);
let deleteMode = 'success';
let deleteCount = 0;
let listCount = 0;
let holdNextList = false;
let releaseList;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/bundle.js') {
    res.setHeader('Content-Type', 'application/javascript');
    return res.end(bundle.outputFiles[0].text);
  }
  if (url.pathname === '/api/soups') {
    listCount++;
    const offset = Number(url.searchParams.get('offset'));
    const limit = Number(url.searchParams.get('limit'));
    const payload = JSON.stringify({ soups: soups.slice(offset, offset + limit), total: soups.length });
    // Reproduce the pre-fix server policy; the client must bypass existing cached responses too.
    res.setHeader('Cache-Control', 'private, max-age=15, stale-while-revalidate=45');
    res.setHeader('Content-Type', 'application/json');
    if (holdNextList) {
      holdNextList = false;
      await new Promise(resolve => { releaseList = resolve; });
    }
    return res.end(payload);
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/soups/')) {
    deleteCount++;
    res.setHeader('Content-Type', 'application/json');
    if (deleteMode === 'blocked') {
      res.statusCode = 409;
      return res.end(JSON.stringify({ error: '该海龟汤正在游戏房间中使用，请在本轮结束后再删除' }));
    }
    if (deleteMode === 'invalid') return res.end('{}');
    soups = soups.filter(soup => soup.id !== url.pathname.split('/').at(-1));
    return res.end('{"ok":true}');
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<div id="toast" role="status"></div><div id="root"></div><script src="/bundle.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === '1' ? undefined : 'msedge', headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let accept = true;
  page.on('dialog', dialog => accept ? dialog.accept() : dialog.dismiss());
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await expect(page.getByText('共 11 条', { exact: true })).toBeVisible();
  const beforeDeleteLists = listCount;
  await page.getByRole('button', { name: '删除', exact: true }).first().click();
  await expect(page.getByRole('button', { name: '回归汤品11', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '回归汤品1', exact: true })).toHaveCount(0);
  assert.ok(listCount > beforeDeleteLists, 'Deletion reloads a fresh page and fills the vacant row');
  await page.reload();
  await expect(page.getByText('共 10 条', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '回归汤品1', exact: true })).toHaveCount(0);

  accept = false;
  const beforeCancel = deleteCount;
  await page.getByRole('button', { name: '删除', exact: true }).first().click();
  assert.equal(deleteCount, beforeCancel);
  accept = true;
  deleteMode = 'blocked';
  await page.getByRole('button', { name: '删除', exact: true }).first().click();
  await expect(page.getByRole('status')).toContainText('正在游戏房间中使用');
  await expect(page.getByText('共 10 条', { exact: true })).toBeVisible();
  deleteMode = 'invalid';
  await page.getByRole('button', { name: '删除', exact: true }).first().click();
  await expect(page.getByRole('status')).toHaveText('删除未成功，请刷新后重试');
  await expect(page.getByRole('button', { name: '回归汤品2', exact: true })).toBeVisible();

  // A pre-delete request arriving late must not restore the removed row.
  deleteMode = 'success';
  holdNextList = true;
  await page.getByRole('button', { name: '倒序', exact: true }).click();
  await expect.poll(() => typeof releaseList).toBe('function');
  await page.getByRole('button', { name: '删除', exact: true }).first().click();
  await expect(page.getByText('共 9 条', { exact: true })).toBeVisible();
  const oldResponse = page.waitForResponse(response => response.url().includes('/api/soups?'));
  releaseList();
  await (await oldResponse).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.getByRole('button', { name: '回归汤品2', exact: true })).toHaveCount(0);
  await expect(page.getByText('共 9 条', { exact: true })).toBeVisible();

  soups = makeSoups(11);
  await page.reload();
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.getByText('第 2 / 2 页', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await expect(page.getByText('第 1 / 1 页', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '删除', exact: true })).toHaveCount(10);
  assert.deepEqual(errors, []);
  console.log('PASS: fresh reload, refill, cancel, API errors, invalid success, stale response, last-page deletion');
} finally {
  releaseList?.();
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
