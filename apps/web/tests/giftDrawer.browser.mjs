// Exercise the real component and CSS with coordinate-based browser input.
// APIs/context are isolated so this never sends gifts or contacts a server.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import loadConfig from 'tailwindcss/loadConfig.js';
import { chromium, expect } from '@playwright/test';

const bundle = await build({
  stdin: { resolveDir: resolve('apps/web'), loader: 'tsx', contents: `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {MemoryRouter} from 'react-router-dom';
    import {GiftDrawer} from './src/components/GiftDrawer';
    import {SiteFooter} from './src/components/SiteFooter';
    window.sent = [];
    const icon = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192"><circle cx="96" cy="96" r="60" fill="pink"/></svg>');
    window.gifts = Array.from({length:12}, (_,i)=>({id:'g'+i,name:'礼物'+i,description:'测试礼物',iconUrl:icon,costAmount:10,inventoryQuantity:20}));
    function Harness(){const [open,setOpen]=useState(true);window.setGiftOpen=setOpen;return <MemoryRouter initialEntries={['/users/u2']}><div className="app-shell" style={{minHeight:'calc(100dvh - 160px)'}}><main><GiftDrawer open={open} recipient={{id:'u2',nickname:'测试用户'}} isFollowing source={{type:'private',id:'p1'}} onClose={()=>setOpen(false)}/></main></div><SiteFooter/></MemoryRouter>}
    createRoot(document.getElementById('root')).render(<Harness/>);
  ` },
  bundle: true, write: false, format: 'iife', define: { 'import.meta.env': '{}' },
  plugins: [{ name: 'isolate-gift-services', setup(build) {
    build.onLoad({filter:/[\\/]context[\\/]AppContext\.tsx$/},()=>({loader:'js',contents:'export function useApp(){return {user:null,showToast:()=>{}}}'}));
    build.onLoad({filter:/[\\/]shared[\\/]useShellBalance\.ts$/},()=>({loader:'js',contents:'export function useShellBalance(){return 10000} export function publishShellBalance(){}'}));
    build.onLoad({filter:/[\\/]api\.ts$/},()=>({loader:'js',contents:`export async function api(path,options){if(path==='/api/gifts')return {gifts:window.gifts};window.sent.push(options.body);return {gift:{},shellBalance:9990,inventoryQuantity:19}}`}));
  }}],
});
const css = (await postcss([tailwindcss({
  ...loadConfig(resolve('apps/web/tailwind.config.ts')),
  content: [{raw:readFileSync(resolve('apps/web/src/components/GiftDrawer.tsx'),'utf8'),extension:'tsx'}],
})]).process(readFileSync(resolve('apps/web/src/styles.css'),'utf8').replace('@import "./cardBattleEffects.css";',readFileSync('apps/web/src/cardBattleEffects.css','utf8')), {from:undefined})).css;
const browser = await chromium.launch({channel:process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM==='1'?undefined:'msedge',headless:true});
try {
  for (const [width,height] of [[1365,556],[320,568],[375,812],[390,844],[430,932],[768,900],[855,556],[1365,900],[812,375]]) {
    const page = await browser.newPage({viewport:{width,height},hasTouch:true,isMobile:width<768,reducedMotion:'reduce'});
    const errors = [];
    page.on('pageerror', error=>errors.push(error.message));
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now()+1000));
    await page.route('**/*',route=>route.abort());
    await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
    await page.addStyleTag({content:css});
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    const send = page.getByRole('button',{name:'送出',exact:true});
    await expect(send).toBeVisible();
    assert.equal(await send.evaluate(element=>{
      const rect=element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));
    }),true,'The send button must receive input above the page and footer.');
    if(width>=1024) {
      const footerBox=await page.locator('.site-footer').boundingBox();
      assert.ok(footerBox.y<height && footerBox.y+footerBox.height>0,'The real footer must overlap the viewport.');
      assert.equal(await page.evaluate(({x,y})=>Boolean(document.elementFromPoint(x,y)?.closest('.site-footer')),
        {x:4,y:Math.min(height-4,footerBox.y+footerBox.height/2)}),false,'The backdrop must cover footer links outside the drawer.');
    }
    await page.getByRole('button',{name:'送出9份',exact:true}).click();
    await expect(page.getByRole('button',{name:'关闭送礼弹框',exact:true})).toBeInViewport();
    await expect(page.getByRole('button',{name:'送出',exact:true})).toBeInViewport();
    const minus = page.getByRole('button',{name:'减少礼物数量',exact:true});
    const quantity = page.getByLabel('礼物数量',{exact:true});
    const card = page.getByRole('button',{name:'选择礼物0，再次点击增加数量',exact:true});
    const image = page.getByRole('img',{name:'礼物0',exact:true});
    const box = await minus.boundingBox();
    assert.ok(box.width>=44 && box.height>=44);
    assert.equal(await minus.evaluate(element=>element.parentElement.closest('button')),null);
    const imageBox = await image.boundingBox();
    assert.ok(imageBox.y>=box.y+box.height,'The decrement target must not cover the gift image.');
    const imagePoint = {x:imageBox.x+imageBox.width/2,y:imageBox.y+imageBox.height/2};
    // Real hit testing: do not use locator.click/force, which can move away from an occlusion.
    for (const input of ['mouse','touch']) {
      for (const [dx,dy] of [[30,14],[7,7],[22,7],[37,7],[7,22],[22,22],[37,22],[7,37],[22,37],[37,37]]) {
        await page.getByRole('button',{name:'送出9份',exact:true}).click();
        const point = {x:box.x+dx,y:box.y+dy};
        const hit = await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('button')?.getAttribute('aria-label'),point);
        assert.equal(hit,'减少礼物数量',`Decrement hit target at ${width}px (${dx},${dy})`);
        if(input==='touch')await page.touchscreen.tap(point.x,point.y);
        else await page.mouse.click(point.x,point.y);
        await expect(quantity).toHaveText('8');
      }
    }
    // Repeated taps at the same coordinate stay at the lower bound, without disappearing.
    for(let i=0;i<12;i++)await page.touchscreen.tap(box.x+30,box.y+14);
    await expect(quantity).toHaveText('1');
    await expect(minus).toBeDisabled();
    await page.touchscreen.tap(imagePoint.x,imagePoint.y);
    await expect(quantity).toHaveText('2');
    await minus.focus(); await page.keyboard.press('Enter');
    await expect(quantity).toHaveText('1');
    await card.focus(); await page.keyboard.press('Space');
    await expect(quantity).toHaveText('2');
    await minus.focus(); await page.keyboard.press('Space');
    await expect(quantity).toHaveText('1');

    await page.getByRole('button',{name:'送出9份',exact:true}).click();
    await page.mouse.move(imagePoint.x,imagePoint.y); await page.mouse.down();
    await page.clock.runFor(420); await expect(quantity).toHaveText('10');
    await page.clock.runFor(180); await expect(quantity).toHaveText('12');
    await page.mouse.up(); await expect(quantity).toHaveText('12');
    await page.clock.runFor(600); await expect(quantity).toHaveText('12');
    await page.touchscreen.tap(box.x+30,box.y+14);
    await expect(quantity).toHaveText('11');
    await page.clock.runFor(600); await expect(quantity).toHaveText('11');
    await page.mouse.move(box.x+30,box.y+14); await page.mouse.down();
    await page.clock.runFor(700); await expect(quantity).toHaveText('11');
    await page.mouse.up(); await expect(quantity).toHaveText('10');
    await page.touchscreen.tap(imagePoint.x,imagePoint.y); await expect(quantity).toHaveText('11');

    // Moving within the card (not just leaving it) cancels the hold and its trailing click.
    await page.mouse.move(imagePoint.x,imagePoint.y); await page.mouse.down();
    await page.mouse.move(imagePoint.x,imagePoint.y+15);
    await page.clock.runFor(700); await page.mouse.up();
    await expect(quantity).toHaveText('11');
    for(const cancel of ['pointercancel','lostpointercapture','blur']) {
      await page.mouse.move(imagePoint.x,imagePoint.y); await page.mouse.down();
      await page.clock.runFor(420); await expect(quantity).toHaveText('12');
      if(cancel==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
      else await card.dispatchEvent(cancel,{pointerId:1,isPrimary:true});
      await page.clock.runFor(700); await page.mouse.up();
      await expect(quantity).toHaveText('12');
      await minus.click(); await expect(quantity).toHaveText('11');
    }
    await page.getByRole('button',{name:'送出666份',exact:true}).click();
    await page.touchscreen.tap(imagePoint.x,imagePoint.y);
    await expect(quantity).toHaveText('666');
    await page.getByRole('button',{name:'选择礼物1，再次点击增加数量',exact:true}).click();
    await expect(quantity).toHaveText('1');
    await image.click(); await expect(quantity).toHaveText('1');

    // Closing while held must release timers even though GiftDrawer stays mounted.
    await page.mouse.move(imagePoint.x,imagePoint.y); await page.mouse.down();
    await page.clock.runFor(420); await expect(quantity).toHaveText('2');
    await page.evaluate(()=>window.setGiftOpen(false));
    await page.mouse.up(); await page.clock.runFor(700);
    await page.evaluate(()=>window.setGiftOpen(true));
    await expect(quantity).toHaveText('1');
    await page.clock.runFor(700); await expect(quantity).toHaveText('1');
    await page.touchscreen.tap(imagePoint.x,imagePoint.y); await expect(quantity).toHaveText('2');
    if(width===375) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...imagePoint,id:1}]});
      await page.clock.runFor(420); await expect(quantity).toHaveText('3');
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await page.clock.runFor(600); await expect(quantity).toHaveText('3');
      await minus.click(); await expect(quantity).toHaveText('2');
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...imagePoint,id:1}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:imagePoint.x,y:imagePoint.y-25,id:1}]});
      await page.clock.runFor(700);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await expect(quantity).toHaveText('2');
      await cdp.detach();
    }
    if(width===375 || width===1365){mkdirSync(resolve('artifacts/gift-drawer'),{recursive:true});await page.screenshot({path:resolve(`artifacts/gift-drawer/overlay-${width}x${height}.png`)});}
    await send.click();
    assert.equal(await page.evaluate(()=>window.sent[0].quantity),2);
    assert.deepEqual(errors,[]);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    if(width>=1024) {
      await page.evaluate(()=>window.setGiftOpen(true));
      await expect(send).toBeVisible();
      await page.mouse.click(4,height-4);
      await expect(send).toHaveCount(0);
    }
    console.log(`PASS ${width}×${height}: footer stacking, backdrop dismissal, mouse/touch hit regions, bounds, keyboard, hold release/cancel, reopen and submitted quantity`);
    await page.close();
  }
} finally { await browser.close(); }
