// Real balance hook, shared SSE dispatcher and API decoder; no external requests.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { resolve } from "node:path";

const bundle = await build({ stdin: { resolveDir: resolve("apps/web"), loader: "tsx", contents: `
import React from'react';import{createRoot}from'react-dom/client';import{useShellBalance}from'./src/shared/useShellBalance';
window.pending=[];window.serverBalance=100;window.hold=false;window.fail=false;window.requestCount=0;
window.fetch=async()=>{window.requestCount++;if(window.fail)throw Error('offline');if(window.hold)return new Promise(resolve=>window.pending.push(balance=>resolve(new Response(JSON.stringify({balance})))));return new Response(JSON.stringify({balance:window.serverBalance}));};
window.EventSource=class extends EventTarget{constructor(){super();window.events=this}close(){}};
window.send=(type,data={})=>window.events.dispatchEvent(new MessageEvent(type,{data:JSON.stringify(data)}));
function Harness(){const balance=useShellBalance('u1');return<output aria-label="贝壳余额">{balance??'loading'}</output>};
createRoot(document.getElementById('root')).render(<Harness/>);
` }, bundle: true, write: false, format: "iife", define: { "import.meta.env": "{}" } });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === "1" ? undefined : "msedge", headless: true });
try {
  const page = await browser.newPage(); const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => route.abort());
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const balance = page.getByLabel('贝壳余额');
  await expect(balance).toHaveText('100');
  await page.evaluate(() => { window.serverBalance=1600;window.send('unread_changed',{source:'admin_shell_grant_issued'}); });
  await expect(balance).toHaveText('1600');
  await page.evaluate(() => { window.serverBalance=1700;window.send('connected'); });
  await expect(balance).toHaveText('1700');
  await page.evaluate(() => { window.serverBalance=1800;window.dispatchEvent(new Event('focus')); });
  await expect(balance).toHaveText('1800');
  const requestsAfterFocus = await page.evaluate(() => window.requestCount);
  await page.evaluate(() => { window.serverBalance=1900;document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(await page.evaluate(() => window.requestCount), requestsAfterFocus, 'same foreground transition should refresh once');
  await page.waitForTimeout(550);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(balance).toHaveText('1900');
  await page.evaluate(() => { window.hold=true;window.send('connected');window.send('unread_changed',{source:'admin_shell_grant_claimed'}); });
  await expect.poll(() => page.evaluate(() => window.pending.length)).toBe(2);
  await page.evaluate(() => window.pending[1](2200));
  await expect(balance).toHaveText('2200');
  await page.evaluate(() => window.pending[0](2000));
  await expect(balance).toHaveText('2200');
  await page.evaluate(() => { window.hold=false;window.fail=true;window.dispatchEvent(new Event('online')); });
  await expect(balance).toHaveText('2200');
  assert.deepEqual(errors, []);
  console.log('PASS: grant notification, SSE reconnect, foreground resume, stale response ordering and failed-refresh balance preservation.');
} finally { await browser.close(); }
