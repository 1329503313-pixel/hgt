// Real voice provider, controls and seats with fake RTC/network/media; never contacts TRTC.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import loadConfig from 'tailwindcss/loadConfig.js';
import { chromium, expect } from '@playwright/test';

const bundle = await build({ stdin: { resolveDir: resolve('apps/web'), loader: 'tsx', contents: `
  import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter,Routes,Route} from 'react-router-dom';
  import OnlineSoupRoomPage from './src/pages/OnlineSoupRoomPage';
  import {OnlineSoupVoiceProvider,useOnlineSoupVoice} from './src/context/OnlineSoupVoiceContext';
  import {OnlineSoupVoiceControls,OnlineSoupVoiceStage} from './src/components/OnlineSoupVoiceRoom';
  import {OnlineSoupHonorCard} from './src/components/OnlineSoupHonorCard';
  function View(){const voice=useOnlineSoupVoice();window.voiceState=voice;return <main style={{maxWidth:700,margin:'auto'}}><OnlineSoupVoiceStage snapshot={window.snapshot} onOpenUser={()=>{}}/><OnlineSoupVoiceControls roomId="test"/><OnlineSoupHonorCard honors={{version:2,communicationMode:'voice',mvp:{userId:'p1',nickname:'MVP玩家',avatar:null,progressContribution:0},bestQuestion:null}}/></main>}
  const root=createRoot(document.getElementById('root'));window.mountFull=()=>root.render(<MemoryRouter key="full" initialEntries={['/online-soup/rooms/test']}><OnlineSoupVoiceProvider><Routes><Route path="/online-soup/rooms/:roomId" element={<OnlineSoupRoomPage/>}/></Routes></OnlineSoupVoiceProvider></MemoryRouter>);
  root.render(<MemoryRouter initialEntries={['/online-soup/rooms/test']}><OnlineSoupVoiceProvider><View/></OnlineSoupVoiceProvider></MemoryRouter>);
` }, bundle: true, write: false, metafile: true, format: 'iife', define: { 'import.meta.env': '{}' }, plugins: [{ name: 'offline-services', setup(b) {
  b.onLoad({ filter: /[\\/]context[\\/]AppContext\.tsx$/ }, () => ({ loader: 'js', contents: `const context={user:{id:'host',nickname:'主持人',role:'user'},loadingUser:false,showToast:()=>{},openAuth:()=>{},setUser:()=>{},triggerRefresh:()=>{}};export const useApp=()=>context;export const formatViews=String,soupDifficulties=[],soupTypes=[];` }));
  b.onLoad({ filter: /[\\/]context[\\/]OnlineSoupDockContext\.tsx$/ }, () => ({ loader: 'js', contents: `const dock={minimizeRoom:()=>{},showFullRoom:()=>{},syncRoomBackgroundMusic:()=>{},backgroundMusicMuted:false,backgroundMusicAutoplayBlocked:false,toggleBackgroundMusicMuted:()=>{}};export const useOnlineSoupDock=()=>dock;` }));
  b.onLoad({ filter: /[\\/]shared[\\/]onlineSoupSocket\.ts$/ }, () => ({ loader: 'js', contents: `export const connectOnlineSoupSocket=()=>()=>{};` }));
  b.onLoad({ filter: /[\\/]api\.ts$/ }, () => ({ loader: 'js', contents: `export class ApiError extends Error{};export const api=(...args)=>window.fixtureApi(...args);` }));
  b.onResolve({ filter: /^trtc-sdk-v5$/ }, () => ({ path: 'fake-sdk', namespace: 'rtc' }));
  b.onLoad({ filter: /.*/, namespace: 'rtc' }, () => ({ loader: 'js', contents: `
    const EVENT={AUDIO_VOLUME:'volume',AUTOPLAY_FAILED:'autoplay',NETWORK_QUALITY:'quality',CONNECTION_STATE_CHANGED:'connection',KICKED_OUT:'kicked',ERROR:'error'};
    export default {EVENT,TYPE:{SCENE_RTC:'rtc'},create(){const handlers={};const rtc={on:(e,fn)=>handlers[e]=fn,emit:(e,data)=>handlers[e]?.(data),enterRoom:async()=>{},exitRoom:async()=>{},destroy:()=>{},enableAudioVolumeEvaluation:()=>{},muteRemoteAudio:async()=>{},startLocalAudio:async()=>{window.publishCount++;if(window.delayPublish)await new Promise(r=>window.resolvePublish=r)},stopLocalAudio:async()=>{}};window.rtc=rtc;return rtc;}};
  ` }));
} }] });
const raw = Object.keys(bundle.metafile.inputs).filter(p => p.startsWith('apps/web/src/') && /\.[tj]sx?$/.test(p)).map(p => readFileSync(p,'utf8')).join('\n');
const css = (await postcss([tailwindcss({ ...loadConfig(resolve('apps/web/tailwind.config.ts')), content: [{ raw, extension: 'tsx' }] })]).process(readFileSync('apps/web/src/styles.css','utf8'), { from: undefined })).css;
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM === '1' ? undefined : 'msedge', headless: true });
const output = mkdtempSync(resolve(tmpdir(),'hgt-voice-'));
try {
  for (const [width,height] of [[375,812],[812,375],[1440,1000]]) {
    const page = await browser.newPage({ viewport: { width,height }, reducedMotion: 'reduce' }); const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>route.request().resourceType()==='document'?route.fulfill({body:'<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>',contentType:'text/html'}):route.abort());
    await page.goto('https://voice.test');
    await page.evaluate(()=>{
      window.snapshot={room:{id:'test',communicationMode:'voice',status:'playing'},members:[{id:'host',nickname:'主持人',role:'host'},...Array.from({length:10},(_,i)=>({id:'p'+(i+1),nickname:'玩家'+(i+1),role:'player',voiceSeat:i+1}))]};
      window.publishCount=0;window.tracks=[];let sessions=0;
      window.fixtureApi=async(path)=>path.endsWith('/session')?{sessionId:'s'+(++sessions),sdkAppId:123,userId:'local',strRoomId:'test',userSig:'offline',privateMapKey:'offline',canPublish:true}:path.endsWith('/heartbeat')?{members:[{rtcUserId:'remote',userId:'p1',canPublish:true}]}:{ok:true};
      Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>{
        if(window.rejectPermission)throw Error('denied');
        if(window.delayPermission)await new Promise(r=>window.resolvePermission=r);
        const track={enabled:true,readyState:'live',stop(){this.readyState='ended'}};window.tracks.push(track);return {getTracks:()=>[track],getAudioTracks:()=>[track]};
      }}});
    });
    await page.addStyleTag({content:css});await page.addScriptTag({content:bundle.outputFiles[0].text});
    await expect(page.locator('.voice-seat')).toHaveCount(11); await expect(page.getByText('最具价值提问',{exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'连接语音',exact:true}).click(); const ptt=page.locator('.voice-ptt');await expect(ptt).toBeEnabled();
    await ptt.dispatchEvent('pointerdown',{button:0,pointerId:1}); await expect(page.getByText('正在发言中',{exact:true})).toBeVisible();
    await ptt.dispatchEvent('pointerup',{pointerId:1}); await expect(ptt).toHaveAttribute('aria-pressed','false'); assert.equal(await page.evaluate(()=>window.tracks.at(-1).readyState),'ended');
    await page.getByRole('button',{name:'切换为麦克风常开',exact:true}).click();await expect(ptt).toHaveCount(0);await expect(page.getByText('正在发言中',{exact:true})).toBeVisible();
    await page.evaluate(()=>window.rtc.emit('volume',{result:[{userId:'remote',volume:30},{userId:'local',volume:30}]})); await expect(page.locator('.voice-seat.is-speaking')).toHaveCount(2);
    await page.screenshot({path:resolve(output,`voice-${width}x${height}.png`),fullPage:true});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.evaluate(()=>window.rtc.emit('connection',{state:'RECONNECTING'}));assert.ok(await page.evaluate(()=>window.tracks.every(t=>t.readyState==='ended')));
    await page.evaluate(()=>window.rtc.emit('connection',{state:'RECONNECTED'}));await expect(ptt).toHaveAttribute('aria-pressed','false');
    await page.evaluate(()=>window.dispatchEvent(new Event('hgt-native-background'))); await expect(page.getByRole('button',{name:'连接语音',exact:true})).toBeVisible();assert.ok(await page.evaluate(()=>window.tracks.every(t=>t.readyState==='ended')));
    await page.getByRole('button',{name:'连接语音',exact:true}).click(); await expect(ptt).toBeVisible();await expect(ptt).toHaveAttribute('aria-pressed','false');
    await page.evaluate(()=>window.delayPermission=true);await ptt.dispatchEvent('pointerdown',{button:0,pointerId:1});await ptt.dispatchEvent('pointercancel',{pointerId:1});
    const before=await page.evaluate(()=>window.publishCount);await page.evaluate(()=>{window.resolvePermission();window.delayPermission=false});await page.waitForTimeout(50);assert.equal(await page.evaluate(()=>window.publishCount),before);assert.ok(await page.evaluate(()=>window.tracks.every(t=>t.readyState==='ended')));
    await page.evaluate(()=>window.rejectPermission=true);await ptt.press('Space');await expect(page.getByRole('alert')).toContainText('无法使用麦克风');
    assert.deepEqual(errors,[]);
    await page.evaluate(()=>{
      window.rejectPermission=false;
      Object.assign(window.snapshot.room,{name:'语音测试房间',code:'123456',hostMode:'human',contentType:'soup',hostOnline:true,playerCount:10,playerCapacity:10,participantCapacity:11,currentRoundId:'round',questionLimit:null,questionCount:0,remainingQuestionCount:null,backgroundMusic:null,soup:{id:'soup',title:'测试汤',surface:'这是汤面',bottom:'这是汤底',manual:'主持人手册',supplementalBottoms:[],supplementalSurfaces:[],visibleSupplementalSurfaces:[],publishedBottomIndices:[],publishedSurfaceIndices:[]}});
      Object.assign(window.snapshot,{me:{role:'host',isHost:true},messages:[],messagesHasMore:false,messagesNextCursor:null});
      window.snapshot.members=window.snapshot.members.map(m=>({...m,level:1,vipLevel:0,vipActive:false,avatar:null,mutedUntil:null,isRoomHost:m.id==='host',joinedAt:new Date().toISOString()}));
      window.calls=[];const original=window.fixtureApi;window.fixtureApi=async(path,options)=>{
        window.calls.push({path,body:options?.body});
        if(path==='/api/online-soup/rooms/test'||path.endsWith('/state'))return window.snapshot;
        if(path.endsWith('/voice/mvp-candidates'))return{candidates:window.snapshot.members.filter(m=>m.role==='player')};
        if(path.includes('/clues'))return{clues:[],hasMore:false};
        if(path.includes('/messages'))return{messages:[],hasMore:false};
        if(path.includes('/voice/'))return original(path,options);
        return{ok:true,series:[]};
      };window.mountFull();
    });
    await expect(page.locator('.voice-seat')).toHaveCount(11);
    await expect(page.locator('textarea.room-message-input')).toHaveCount(0);await expect(page.getByRole('tab',{name:'进度',exact:true})).toHaveCount(0);
    await page.screenshot({path:resolve(output,`voice-room-${width}x${height}.png`),fullPage:true});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await expect(page.getByRole('button',{name:'连接语音',exact:true})).toBeInViewport();
    if(width<1024)await page.getByRole('button',{name:'语音房更多操作',exact:true}).click();
    await page.getByRole('button',{name:'发布汤底',exact:true}).filter({visible:true}).click();
    await page.getByRole('button',{name:/主汤底/}).click();await expect(page.getByRole('heading',{name:'请选择本场 MVP'})).toBeVisible();
    await page.getByRole('radio',{name:/玩家1$/,exact:false}).first().check({force:true});
    await page.getByRole('button',{name:'确定',exact:true}).click();await expect(page.getByRole('heading',{name:'确认发布主汤底？'})).toBeVisible();
    await page.getByRole('button',{name:'确认发布',exact:true}).click();
    const publish=await page.evaluate(()=>window.calls.find(c=>c.path.endsWith('/publish-bottom')));assert.equal(publish.body.mvpUserId,'p1');assert.ok(!publish.body.bestQuestionMessageId);
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log('PASS browser: 11 seats, MVP only, push-to-talk release/cancel, permission races, always-on toggle, multiple speakers, Android background, reconnect muted, permission errors, portrait/landscape/desktop, reduced motion. Screenshots: '+output);
} finally { await browser.close(); }
