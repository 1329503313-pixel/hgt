import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const contextMock = `import {useState} from 'react';export function useApp(){const [evalForm,setEvalForm]=useState(window.initialForm);return {evalForm,setEvalForm,soupIdForEval:'soup',closeEvalEditor:()=>window.editorClosed=true,showToast:m=>window.toasts.push(m),checkBadgeUnlocks:async()=>{},triggerRefresh:()=>{},refreshKey:0,user:window.testUser,loadingUser:false,openAuth:()=>{},openEvalEditor:(_id,e)=>window.openedEvaluation=e};}`;
const bundle = await build({ stdin: { resolveDir: resolve('apps/web'), loader: 'tsx', contents: `
import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter,Routes,Route} from 'react-router-dom';
import {EvalEditor} from './src/components/EvalEditor';import {EvaluationCard} from './src/components/EvaluationCard';
import {EvaluationManagement} from './src/components/admin/EvaluationManagement';import MyInteractionsPage from './src/pages/MyInteractionsPage';import SoupEvaluationsPage from './src/pages/SoupEvaluationsPage';
window.initialForm={total:'4.5',writing:'4',logic:'',share:'',mechanism:'',twist:'',depth:'',content:'评价内容',isAnonymous:false};
window.testUser={id:'viewer',nickname:'查看者',username:'viewer',role:'user'};window.toasts=[];window.requests=[];
const raw={id:'e1',soupId:'soup',soupTitle:'测试汤',reviewer:'真实昵称',reviewerId:'secret-user',reviewerAvatar:'/secret-user.png',reviewerLevel:40,reviewerVipLevel:9,reviewerVipActive:true,reviewerEquippedBadge:{key:'secret',name:'秘密徽章',iconUrl:'/secret-badge.png',tier:'legend'},isCreatorEvaluation:true,countsTowardScore:false,total:4.5,writing:4,logic:null,share:null,mechanism:null,twist:null,depth:null,content:'评价内容',isContentHidden:false,createdAt:'2026-09-09T00:00:00.000Z',isAnonymous:true,isOwnEvaluation:true};
window.raw=raw;const rows=Array.from({length:24},(_,i)=>({...raw,id:'e'+i,isAnonymous:i<12,reviewer:'真实昵称'+i}));
window.fetch=async(url,opts={})=>{const u=new URL(String(url),'http://test.local'),method=opts.method||'GET',body=opts.body?JSON.parse(opts.body):undefined;window.requests.push({path:u.pathname,search:u.search,method,body});let data={};
if(method==='POST'){if(window.holdSubmit)await new Promise(r=>window.releaseSubmit=r);if(window.failSubmit)return new Response(JSON.stringify({error:'保存失败，请重试'}),{status:409});data={id:'e1'};}
else if(method==='PATCH'){const row=rows.find(r=>u.pathname.endsWith('/'+r.id));Object.assign(row,body);data={evaluation:row};}
else if(u.pathname==='/api/admin/evaluations'){const type=u.searchParams.get('evaluationType'),keyword=u.searchParams.get('keyword')||'';const filtered=rows.filter(r=>(type==='anonymous'?r.isAnonymous:type==='normal'?!r.isAnonymous:true)&&r.reviewer.includes(keyword));const offset=Number(u.searchParams.get('offset'));data={evaluations:filtered.slice(offset,offset+Number(u.searchParams.get('limit'))),total:filtered.length};}
else if(u.pathname==='/api/me/received-interactions')data={soups:[{id:'soup',title:'测试汤',coverImage:null,likeCount:0,favoriteCount:0,evaluationCount:1}]};
else if(u.pathname==='/api/me/soups/soup/interactions')data={title:'测试汤',interactions:[{id:'e1',userId:'secret-user',nickname:'真实昵称',avatar:'/secret-user.png',isAnonymous:true,total:4.5,content:'评价内容',createdAt:raw.createdAt}]};
else if(u.pathname==='/api/soups/soup')data={soup:{id:'soup',title:'测试汤',canViewFull:true,evaluations:[{...raw,reviewer:'匿名用户',reviewerId:null,reviewerAvatar:null}],averageTotal:4.5}};
return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});};
const root=createRoot(document.getElementById('root'));let revision=0;window.mount=mode=>root.render(<MemoryRouter key={++revision} initialEntries={['/soup/soup/evaluations']}><main className="p-4">{mode==='editor'?<EvalEditor/>:mode==='admin'?<EvaluationManagement/>:mode==='interactions'?<MyInteractionsPage/>:mode==='own'?<Routes><Route path="/soup/:id/evaluations" element={<SoupEvaluationsPage/>}/></Routes>:<><EvaluationCard evaluation={raw}/><EvaluationCard evaluation={raw} compact/></>}</main></MemoryRouter>);window.mount('cards');
` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader:{'.webp':'dataurl'}, define: {'process.env.NODE_ENV':'"test"','import.meta.env':'{}'}, plugins: [{name:'test-context',setup(b){b.onResolve({filter:/context\/AppContext$/},()=>({path:'mock-context',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:contextMock,loader:'tsx',resolveDir:resolve('apps/web')}));}}] });
const cssDir = resolve('apps/web/dist/assets');
const css = readdirSync(cssDir).filter(f=>f.endsWith('.css')).map(f=>readFileSync(resolve(cssDir,f),'utf8')).join('\n');
const browser = await chromium.launch({channel:'msedge',headless:true});
mkdirSync('artifacts/anonymous-evaluations',{recursive:true});
try {
  for (const [name,viewport] of [['desktop',{width:1365,height:900}],['mobile',{width:375,height:812}],['landscape',{width:812,height:375}]]) {
    const page=await browser.newPage({viewport,reducedMotion:'reduce'}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.setContent('<html><head><style>'+css+'</style></head><body><div id="root"></div></body></html>');
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    const cards=page.locator('article');await expect(cards).toHaveCount(2);
    for(const card of await cards.all()){await expect(card).toContainText('匿名用户');assert.doesNotMatch(await card.innerHTML(),/真实昵称|secret-user|秘密徽章|Lv40|上传者评价/);await expect(card.locator('img,button,a,[tabindex],input')).toHaveCount(0);}
    await page.screenshot({path:'artifacts/anonymous-evaluations/'+name+'-cards.png'});
    await page.evaluate(()=>window.mount('editor'));
    const checkbox=page.getByRole('checkbox',{name:'匿名评价',exact:true});await expect(checkbox).not.toBeChecked();await expect(page.getByText('勾选后其他人无法看到您的信息')).toBeVisible();
    await checkbox.check();await page.evaluate(()=>{window.failSubmit=true;window.holdSubmit=true;});await page.getByRole('button',{name:'保存评价',exact:true}).click();await expect(checkbox).toBeDisabled();
    await page.evaluate(()=>window.releaseSubmit());await expect(checkbox).toBeEnabled();await expect(checkbox).toBeChecked();
    assert.equal(await page.evaluate(()=>window.requests.at(-1).body.isAnonymous),true);
    await page.evaluate(()=>{window.failSubmit=false;window.holdSubmit=false;});await page.getByRole('button',{name:'保存评价',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.editorClosed)).toBe(true);
    await page.evaluate(()=>{window.initialForm.isAnonymous=true;window.mount('editor');});await expect(checkbox).toBeChecked();
    await checkbox.scrollIntoViewIfNeeded();
    await page.screenshot({path:'artifacts/anonymous-evaluations/'+name+'-editor.png'});
    await checkbox.uncheck();await page.getByRole('button',{name:'保存评价',exact:true}).click();assert.equal(await page.evaluate(()=>window.requests.at(-1).body.isAnonymous),false);
    await page.evaluate(()=>window.mount('own'));await expect(page.getByRole('button',{name:'编辑我的评价'})).toBeVisible();await page.getByRole('button',{name:'编辑我的评价'}).click();assert.equal(await page.evaluate(()=>window.openedEvaluation.isAnonymous),true);
    await page.evaluate(()=>window.mount('interactions'));await page.getByRole('button',{name:'评价 1',exact:true}).click();
    const item=page.getByText('匿名用户', {exact:true}).locator('xpath=../..');await expect(item.locator('button,a,img,[tabindex]')).toHaveCount(0);assert.doesNotMatch(await item.innerHTML(),/真实昵称|secret-user/);
    await page.evaluate(()=>window.mount('admin'));const filter=page.getByLabel('评价类型',{exact:true});await expect(page.getByText('共 24 条')).toBeVisible();
    await page.getByRole('button',{name:'下一页'}).click();await expect(page.getByText('第 2 / 3 页')).toBeVisible();
    await filter.selectOption('anonymous');await expect(page.getByText('共 12 条')).toBeVisible();await expect(page.getByText('第 1 / 2 页')).toBeVisible();await expect(page.getByText('真实昵称0',{exact:true})).toBeVisible();
    assert.equal(await page.evaluate(()=>new URLSearchParams(window.requests.at(-1).search).get('evaluationType')),'anonymous');
    await page.getByPlaceholder('搜索评价者、汤标题、内容...').fill('真实昵称1');await page.getByRole('button',{name:'搜索',exact:true}).click();await expect(page.getByText('共 3 条')).toBeVisible();
    await page.getByRole('button',{name:'编辑',exact:true}).first().click();await expect(page.getByRole('checkbox',{name:'匿名评价',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'保存评价',exact:true}).click();
    await page.getByPlaceholder('搜索评价者、汤标题、内容...').fill('');await page.getByRole('button',{name:'搜索',exact:true}).click();await filter.selectOption('normal');await expect(page.getByText('共 12 条')).toBeVisible();await expect(page.getByText('真实昵称12',{exact:true})).toBeVisible();
    await filter.selectOption('anonymous');await expect(page.getByText('真实昵称0',{exact:true})).toBeVisible();
    await page.evaluate(()=>document.querySelectorAll('*').forEach(element=>{if(element.scrollLeft)element.scrollLeft=0;}));
    await page.screenshot({path:'artifacts/anonymous-evaluations/'+name+'-admin.png'});
    assert.deepEqual(errors,[]);await page.close();console.log('PASS '+name+': anonymous cards, editor save/retry/restore, own edit, interactions and admin filters');
  }
} finally {await browser.close();}
