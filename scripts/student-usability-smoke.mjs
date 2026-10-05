import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createHmac, randomBytes, createHash} from 'node:crypto';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createServer} from 'node:net';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PrismaClient} from '@prisma/client';
import nextEnv from '@next/env';
import {chromium} from 'playwright';

nextEnv.loadEnvConfig(process.cwd(), true);
const root = process.cwd();
const built = resolve(process.env.STUDENT_UX_BUILD_DIR || root);
for (const file of ['src/components/student-assessment/assessment-session-client.tsx', 'src/components/student-assessment/available-assessments-client.tsx']) {
  const hash = p => createHash('sha256').update(readFileSync(p)).digest('hex');
  assert.equal(hash(resolve(root,file)),hash(resolve(built,file)));
}
const source = new URL(process.env.DATABASE_URL);
assert(['localhost','127.0.0.1'].includes(source.hostname));
const admin = new PrismaClient({datasourceUrl:source.href});
const name = 'conversational_mcq_classroom_audit_ux_human_' + randomBytes(4).toString('hex');
const local = new URL(source); local.pathname = '/' + name;
const secret = 'human-ux-isolated-synthetic-secret';
const env = {...process.env, DATABASE_URL:local.href, SESSION_SECRET:secret, NODE_ENV:'test',
  LLM_PROVIDER:'mock',LLM_LIVE_CALLS_ENABLED:'false',FORMATIVE_CONVERSATION_LIVE_CALLS_ENABLED:'false',
  OPENAI_API_KEY:'',OPENAI_API_KEY_FILE:'',ALLOW_LOCAL_MOCK_RUNTIME:'true',ITEM_ADMIN_TUTOR_MODE:'mock',
  APP_ENV:'development',OPERATIONAL_AGENT_MODE:'disabled',OPERATIONAL_LIVE_CANARY_DATABASE_URL_ACTIVE:'false',
  RESEARCH_PSEUDONYMIZATION_KEY:'human-ux-synthetic-research-key',NEXT_TELEMETRY_DISABLED:'1',
  NODE_OPTIONS:`--import ${pathToFileURL(resolve(root,'scripts/classroom-audit-network-guard.mjs')).href}`};
const out=resolve(root,'.data/student-usability-smoke');mkdirSync(out,{recursive:true});
const run=(label,args,cwd=root)=>{const r=spawnSync(process.execPath,args,{cwd,env,encoding:'utf8',timeout:300000,maxBuffer:16e6});writeFileSync(resolve(out,label+'.log'),(r.stdout||'')+(r.stderr||''));assert.equal(r.status,0,label+': '+r.stderr.slice(-1000));return r.stdout;};
let created=false,server,browser;const report={checked_at:new Date().toISOString(),scope:'Isolated real student UI, no live provider calls',checks:[],errors:[]};
const record=(name,data)=>{report.checks.push({name,...data});console.log(name,JSON.stringify(data));};
try{
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);created=true;
  run('migrate',['node_modules/prisma/build/index.js','migrate','deploy']);
  run('seed',['--import','tsx','prisma/seed.ts']);
  run('display-completion-regression',['--import','tsx','prisma/feedback-display-completion-smoke-test.ts']);
  const fixture=JSON.parse(run('fixture',['--import','tsx','prisma/classroom-ux-fixture.ts']).trim().split('\n').at(-1));
  const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
  const base=`http://127.0.0.1:${port}`;
  server=spawn(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),'start','-H','127.0.0.1','-p',String(port)],{cwd:built,env,stdio:['ignore','pipe','pipe']});
  let logs='';server.stdout.on('data',d=>logs+=d);server.stderr.on('data',d=>logs+=d);
  for(let i=0;i<80;i++){try{if((await fetch(base+'/student/login')).ok)break;}catch{} assert.equal(server.exitCode,null,logs.slice(-2000));await new Promise(r=>setTimeout(r,300));}
  browser=await chromium.launch({headless:true});
  const ctx=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
  ctx.setDefaultTimeout(15000);
  const now=Math.floor(Date.now()/1000),u=fixture.student;
  const payload=Buffer.from(JSON.stringify({user_db_id:u.id,user_id:u.user_id,role:u.role,auth_version:u.auth_version,iat:now,exp:now+3600})).toString('base64url');
  await ctx.addCookies([{name:'cmcq_session',value:payload+'.'+createHmac('sha256',secret).update(payload).digest('base64url'),url:base,httpOnly:true,sameSite:'Lax'}]);
  await ctx.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  const page=await ctx.newPage();page.on('pageerror',e=>report.errors.push(String(e)));
  const require=createRequire(import.meta.url);let axePath;try{axePath=require.resolve('axe-core/axe.min.js');}catch{}
  const path=`/student/assessment/${fixture.activeSession}`;
  async function inspect(label){
    await page.waitForTimeout(400);
    const metrics=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,width:innerWidth,scrollY,active:document.activeElement?.getAttribute('data-testid')||document.activeElement?.tagName,
      fields:[...document.querySelectorAll('textarea')].map(e=>({id:e.dataset.testid,top:Math.round(e.getBoundingClientRect().top),height:Math.round(e.getBoundingClientRect().height)}))}));
    if(axePath){await page.addScriptTag({path:axePath});metrics.accessibility=await page.evaluate(async()=>(await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)})));}
    record(label,metrics);await page.screenshot({path:resolve(out,label+'.png'),fullPage:false});
    assert.equal(metrics.overflow,false,label+' horizontal overflow');
    assert.deepEqual(metrics.accessibility,[],label+' accessibility');
  }
  await page.goto(base+'/student/assessment',{waitUntil:'networkidle'});await inspect('catalog-mobile');
  await page.goto(base+path,{waitUntil:'networkidle'});
  if(await page.getByTestId('begin-concept-unit').count())await page.getByTestId('begin-concept-unit').click();
  const option=page.locator('[data-testid^="chat-option-card-"]').first();await option.waitFor();
  await inspect('question-mobile');
  await option.focus();await page.keyboard.press('Enter');
  const reason=page.getByTestId('reasoning-input');await reason.waitFor();await page.waitForTimeout(400);await inspect('reasoning-keyboard-focus');
  assert(await reason.evaluate(e=>e===document.activeElement),'keyboard focus should move to the next input');
  await reason.fill('I am considering the distinction between a person estimate and an item parameter.');
  let dialogs=0;const cancel=async d=>{dialogs++;await d.dismiss();};page.on('dialog',cancel);
  await page.reload({waitUntil:'networkidle'});await reason.waitFor();
  record('unsent-reason-refresh',{draft:await reason.inputValue(),warning_count:dialogs});page.off('dialog',cancel);
  assert.equal(await reason.inputValue(),'I am considering the distinction between a person estimate and an item parameter.');
  await reason.fill('This unsent explanation should remain available when I return.');
  page.on('dialog',cancel);await page.getByTestId('save-exit').click();await page.waitForURL(base+'/student/assessment');
  record('unsent-reason-pause',{warning_count:dialogs});page.off('dialog',cancel);
  await page.locator('[data-testid^="resume-assessment-"]').first().click();
  await reason.waitFor();record('unsent-reason-return',{draft:await reason.inputValue()});
  assert.equal(await reason.inputValue(),'This unsent explanation should remain available when I return.');
  const unsentState=await (await ctx.request.get(`${base}/api/student/sessions/${fixture.activeSession}/state`)).json();
  assert.equal(unsentState.current_item.existing_reasoning_text,null,'restoring a draft must not submit it');
  await reason.dispatchEvent('keydown',{key:'Enter',keyCode:229,isComposing:true});
  assert(await reason.isVisible(),'IME confirmation must not submit');
  await reason.fill("Theta describes the person's standing on the latent trait, while calibrated item parameters describe item characteristics.");
  await page.getByTestId('reasoning-input-send').click();await page.getByTestId('chat-confidence-high').waitFor();await inspect('confidence-mobile');
  await page.getByTestId('chat-confidence-high').click();await inspect('temptation-mobile');
  assert((await page.locator('[data-testid^="chat-tempting-option-"]').first().innerText()).length>12,'show option text, not only a letter');
  assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('cmcq-student-draft-v1:')&&k.endsWith(':reasoning')).length),0,'accepted reasoning draft cleared');
  for(const width of [320,768,1440]){await page.setViewportSize({width,height:width===768?540:900});await inspect('temptation-'+width);}
  const api=`/api/student/sessions/${fixture.activeSession}`;
  const longReply=('Your distinction between reliability and validity is useful. Reliability concerns the consistency of scores; validity concerns the evidence for a proposed interpretation and use.\n\n').repeat(12);
  let conversation={conversation_public_id:'synthetic-human-ux',status:'active',started_at:new Date().toISOString(),last_activity_at:new Date().toISOString(),paused_at:null,completed_at:null,opening_status:'ready',can_retry_opening:false,can_send:true,can_pause:true,can_resume:false,can_end:true,message_max_chars:5000,assistant_response:null,
    transcript:[{turn_id:'synthetic-tutor',actor:'tutor',sequence_index:1,message_text:longReply,created_at:new Date().toISOString(),agent_name:null,generation_source:null,validator_status:null,fallback_used:false,response_receipt_public_id:null,assistant_response_status:null,assistant_response_retry_count:0}]};
  await page.route(base+api+'/state',async route=>{const current=await (await route.fetch()).json();await route.fulfill({json:{...current,next_step:'formative_conversation',formative_conversation:conversation}});});
  await page.route(base+api+'/formative-conversation',route=>route.fulfill({json:{formative_conversation:conversation}}));
  await page.setViewportSize({width:390,height:844});await page.goto(base+path,{waitUntil:'networkidle'});await inspect('conversation-loaded');writeFileSync(resolve(out,'conversation-visible.txt'),await page.locator('body').innerText());await page.getByTestId('formative-conversation-input').waitFor();await inspect('conversation-long-reply');
  const replyTop=await page.locator('[data-tutor-turn]').last().evaluate(e=>e.getBoundingClientRect().top);
  assert(replyTop>=0&&replyTop<50,'long reply must open at its beginning');
  await page.evaluate(()=>window.scrollBy(0,350));await page.waitForTimeout(150);
  const readingY=await page.evaluate(()=>scrollY);await page.reload({waitUntil:'networkidle'});await page.waitForTimeout(400);
  assert(Math.abs(await page.evaluate(()=>scrollY)-readingY)<10,'return to the same reading position');
  await page.getByTestId('formative-conversation-input').fill('I have started a question but have not sent it.');await page.reload({waitUntil:'networkidle'});await page.getByTestId('formative-conversation-input').waitFor();record('unsent-conversation-refresh',{draft:await page.getByTestId('formative-conversation-input').inputValue()});
  assert.equal(await page.getByTestId('formative-conversation-input').inputValue(),'I have started a question but have not sent it.');
  assert.equal(await page.getByRole('button',{name:'Pause conversation',exact:true}).count(),0);
  assert.equal(await page.getByTestId('end-attempt').count(),0);
  await page.getByRole('button',{name:'Finish assessment',exact:true}).click();await inspect('end-conversation-dialog');
  assert.match(await page.getByRole('dialog').innerText(),/unsent message will not be submitted/);
  await page.getByRole('button',{name:'Keep talking',exact:true}).click();
  const actions=[];let failFinish=true;
  await page.route(base+api+'/formative-conversation/lifecycle',async route=>{
    const action=route.request().postDataJSON().action;actions.push(action);
    if(action==='finish'&&failFinish){failFinish=false;await route.fulfill({status:503,json:{error:{code:'unavailable',message:'Please try again.'}}});return;}
    conversation={...conversation,status:'ended',can_send:false,can_end:false,can_finish_assessment:true};
    await route.fulfill({json:{formative_conversation:conversation}});
  });
  await page.getByRole('button',{name:'Finish assessment',exact:true}).click();await page.getByTestId('confirm-end-conversation').click();
  await page.getByTestId('finish-assessment').waitFor();assert.deepEqual(actions,['end','finish']);
  await page.getByTestId('finish-assessment').click();await page.waitForTimeout(400);assert.deepEqual(actions,['end','finish','finish'],'interrupted completion can retry without duplicate end');
  record('one-confirmation-completion-and-retry',{actions});
  const pendingReply={...conversation,status:'active',can_send:false,can_end:false,assistant_response:{receipt_public_id:'synthetic-receipt',status:'failed',retry_count:0,can_retry:false}};
  await page.unroute(base+api+'/state');await page.route(base+api+'/state',async route=>{const current=await (await route.fetch()).json();await route.fulfill({json:{...current,next_step:'formative_conversation',formative_conversation:pendingReply}});});
  await page.unroute(base+api+'/formative-conversation');await page.route(base+api+'/formative-conversation',route=>route.fulfill({json:{formative_conversation:pendingReply}}));
  await page.reload({waitUntil:'networkidle'});await inspect('conversation-failure-no-retry');
  record('no-retry-guidance',{text:await page.getByTestId('formative-conversation-controls').innerText()});
  assert.match(await page.getByTestId('formative-conversation-controls').innerText(),/contact your teacher/);
  assert.deepEqual(report.errors,[]);
  writeFileSync(resolve(out,'server.log'),logs);
}catch(error){report.failure=String(error);console.error(error);process.exitCode=1;}
finally{if(browser)await browser.close();if(server){const done=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');const t=setTimeout(()=>server.kill('SIGKILL'),5000);await done;clearTimeout(t);}if(created)await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);await admin.$disconnect();writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(out);}
