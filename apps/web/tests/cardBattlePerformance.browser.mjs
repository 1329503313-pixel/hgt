// Local-only regression for boundary clocks, media identity, fallback and cleanup.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const directory = mkdtempSync(join(tmpdir(), 'hgt-motion-browser-'));
const ffmpeg = process.env.TEST_FFMPEG_PATH || 'ffmpeg';
const pixels = Buffer.alloc(216 * 302 * 3 * 30);
for (let i = 0; i < pixels.length; i += 3) { pixels[i] = Math.floor(i / 3) % 216 < 108 ? 230 : 20; pixels[i + 1] = 70; pixels[i + 2] = 150; }
const encoded = spawnSync(ffmpeg, ['-y', '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', '216x302', '-framerate', '30', '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(directory, 'motion.mp4')], { input: pixels, windowsHide: true });
assert.equal(encoded.status, 0, 'TEST_FFMPEG_PATH must point to FFmpeg: ' + encoded.stderr);
const media = readFileSync(join(directory, 'motion.mp4'));
const source = `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
import{BattleMotionMedia}from'./src/components/BattleMotionMedia';
import{useCardBattleReplayClock}from'./src/shared/useCardBattleReplayClock';
import{battleMotionSources}from'./src/shared/battleMotionSources';
window.pickSources=battleMotionSources;
const boundaries=[550,1000,1550,2000];
function Clock(){window.clockRenders=(window.clockRenders||0)+1;const clock=useCardBattleReplayClock(boundaries,2000,false);window.battleClock=clock;return <output id="clock">{JSON.stringify({elapsed:clock.elapsed,playing:clock.playing})}</output>}
function Harness(){const[visible,set]=useState(true),[version,update]=useState(0),[asset,choose]=useState('plain');window.mountMedia=value=>flushSync(()=>set(value));window.updateEvent=()=>flushSync(()=>update(v=>v+1));window.chooseAsset=id=>flushSync(()=>choose(id));
return <><Clock/>{[0,1].map(index=><div key={index} data-event={version} data-battle-anchor="card" style={{width:90,height:126,position:'relative'}}>{visible&&<BattleMotionMedia name="动态卡" imageUrl="/poster.svg" motionPosterUrl="/poster.svg" motionMp4Url={'/api/media/assets/cards/'+asset+'/motion/mp4'} motionWebmUrl="/broken.webm"/>}</div>)}</>};createRoot(document.getElementById('root')).render(<Harness/>);`;
const bundle = await build({ stdin: { contents: source, loader: 'tsx', resolveDir: resolve('apps/web') }, bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"production"' } });
const css = readFileSync(resolve('apps/web/dist/assets', readdirSync('apps/web/dist/assets').find(file => /^index-.*\.css$/.test(file))), 'utf8');
const requests = [];
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost'); requests.push(url.pathname + url.search);
  if (url.pathname.endsWith('renditions')) {
    const id = url.pathname.split('/')[5];
    if (id === 'offline') { res.writeHead(503).end(); return; }
    const sources = id === 'warm' ? [{ url: '/variant.mp4', type: 'video/mp4; codecs="avc1.640029"', width: 256, height: 358, bitrate: 100000, framerate: 30 }] : [];
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ sources })); return;
  }
  if (url.pathname === '/broken.webm' || url.pathname.includes('/broken/')) { res.writeHead(404).end(); return; }
  if (url.pathname.endsWith('/mp4') || url.pathname === '/variant.mp4') {
    const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/), start = Number(range?.[1] || 0), end = Math.min(Number(range?.[2] || media.length - 1), media.length - 1);
    res.writeHead(range ? 206 : 200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(range ? { 'Content-Range': `bytes ${start}-${end}/${media.length}` } : {}) }); res.end(media.subarray(start, end + 1)); return;
  }
  if (url.pathname === '/poster.svg') { res.setHeader('Content-Type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="216" height="302"><rect width="216" height="302" fill="#543"/></svg>'); return; }
  res.setHeader('Content-Type', 'text/html'); res.end('<meta name="viewport" content="width=device-width"><div id="root"></div>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [], results = {};
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base); await page.addStyleTag({ content: css });
  await page.evaluate(() => {
    window.observers = new Set();
    for (const name of ['IntersectionObserver', 'ResizeObserver']) {
      const Original = window[name];
      window[name] = class extends Original { constructor(...args) { super(...args); window.observers.add(this); } disconnect() { window.observers.delete(this); super.disconnect(); } };
    }
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await expect(page.locator('canvas').first()).toBeVisible();
  await page.evaluate(() => { window.originalVideo = document.querySelector('video'); });
  for (let i = 0; i < 30; i++) await page.evaluate(() => window.updateEvent());
  assert.ok(await page.evaluate(() => window.originalVideo === document.querySelector('video')), 'events keep the same decoder');
  results.canvas = await page.locator('canvas').first().evaluate(canvas => {
    const context = canvas.getContext('2d'), left = [...context.getImageData(canvas.width * .25, canvas.height * .5, 1, 1).data], right = [...context.getImageData(canvas.width * .75, canvas.height * .5, 1, 1).data];
    return { width: canvas.width, height: canvas.height, left, right };
  });
  assert.equal(results.canvas.width, 270); assert.equal(results.canvas.height, 378);
  assert.ok(results.canvas.left[0] > 200 && results.canvas.right[0] < 40, 'card artwork and centered crop remain correct');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => page.locator('video').first().evaluate(video => video.paused)).toBe(true);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(() => page.locator('video').first().evaluate(video => video.paused)).toBe(false);
  await page.evaluate(() => { document.querySelector('[data-battle-anchor]').style.marginTop = '2000px'; });
  await expect.poll(() => page.locator('video').first().evaluate(video => video.paused)).toBe(true);
  await page.evaluate(() => { document.querySelector('[data-battle-anchor]').style.marginTop = '0'; });
  await expect.poll(() => page.locator('video').first().evaluate(video => video.paused)).toBe(false);
  const chosen = await page.evaluate(() => window.pickSources('/api/media/assets/cards/warm/motion/mp4', null, 270));
  assert.ok(chosen[0].url.endsWith('/variant.mp4'));
  const fallbacks = await page.evaluate(async () => Promise.all(['cold', 'offline'].map(id => window.pickSources('/api/media/assets/cards/'+id+'/motion/mp4', '/broken.webm', 270))));
  assert.ok(fallbacks.every(list => list[0].url.endsWith('/motion/mp4')));
  for (let i = 0; i < 20; i++) { await page.evaluate(() => window.mountMedia(false)); await expect.poll(() => page.evaluate(() => window.observers.size)).toBe(0); await page.evaluate(() => window.mountMedia(true)); await expect.poll(() => page.locator('video').first().evaluate(video=>video.readyState)).toBeGreaterThanOrEqual(2); }
  await page.evaluate(() => window.chooseAsset('broken'));
  await expect(page.locator('video')).toHaveCount(0); await expect(page.locator('[data-battle-motion] img').first()).toBeVisible();
  await page.screenshot({ path: join(directory, 'fallback.png') });
  // Native fallback when a platform cannot create a Canvas 2D surface.
  await page.evaluate(() => { window.mountMedia(false); HTMLCanvasElement.prototype.getContext = () => null; window.chooseAsset('plain'); window.mountMedia(true); });
  await expect.poll(() => page.locator('video').first().evaluate(video => video.readyState)).toBeGreaterThanOrEqual(2);
  await expect(page.locator('video').first()).toBeVisible(); await expect(page.locator('canvas').first()).toBeHidden();
  await page.close();

  const clockPage = await browser.newPage();
  await clockPage.clock.install(); await clockPage.clock.pauseAt(Date.now() + 1000);
  await clockPage.goto(base); await clockPage.addScriptTag({ content: bundle.outputFiles[0].text });
  await expect(clockPage.locator('#clock')).toBeVisible();
  await clockPage.evaluate(() => { window.mountMedia(false); window.battleClock.toggle(); });
  await expect.poll(() => clockPage.evaluate(() => window.battleClock.playing)).toBe(true);
  await clockPage.evaluate(() => { window.rendersBefore = window.clockRenders; });
  await clockPage.clock.runFor(500);
  assert.equal(await clockPage.evaluate(() => window.clockRenders - window.rendersBefore), 0, 'no battle rerenders between boundaries');
  await clockPage.clock.runFor(51);
  assert.ok(JSON.parse(await clockPage.locator('#clock').textContent()).elapsed >= 550);
  await clockPage.evaluate(() => window.battleClock.toggle());
  const paused = await clockPage.evaluate(() => window.battleClock.getElapsed());
  await clockPage.clock.runFor(300);
  assert.equal(await clockPage.evaluate(() => window.battleClock.getElapsed()), paused);
  await clockPage.evaluate(() => window.battleClock.seek(1250));
  assert.equal(await clockPage.evaluate(() => window.battleClock.getElapsed()), 1250);
  await clockPage.evaluate(() => window.battleClock.toggle()); await clockPage.clock.runFor(800);
  assert.deepEqual(JSON.parse(await clockPage.locator('#clock').textContent()), { elapsed: 2000, playing: false });
  await clockPage.evaluate(() => window.battleClock.restart());
  assert.deepEqual(JSON.parse(await clockPage.locator('#clock').textContent()), { elapsed: 0, playing: false });
  assert.deepEqual(errors, []);
  results.checks = ['stable decoder through 30 events', 'DPR-sized canvas and original artwork', 'reduced-motion/offscreen pause and resume', 'rendition/original fallback', '20 media unmounts without observer accumulation', 'all sources failing to poster', 'native surface fallback', 'boundary-only clock, pause, seek, finish, restart'];
  mkdirSync('artifacts/card-battle-performance-optimization', { recursive: true });
  writeFileSync('artifacts/card-battle-performance-optimization/regression.json', JSON.stringify(results, null, 2));
  console.log('PASS:', results.checks.join('; '));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); rmSync(directory, { recursive: true, force: true }); }
