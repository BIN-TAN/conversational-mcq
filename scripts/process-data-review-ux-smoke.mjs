import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {spawn} from "node:child_process";
import {createServer} from "node:net";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {openSync, closeSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {chromium} from "playwright";
import {PrismaClient} from "@prisma/client";
import {ensureTeacherReviewDemoFixture, cleanupTeacherReviewDemoFixture, teacherReviewSessionPublicId} from "../prisma/demo-teacher-review-fixture.ts";

const database = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(database.hostname));
assert(database.pathname.startsWith("/conversational_mcq_classroom_audit_"));
assert.equal(process.env.LLM_LIVE_CALLS_ENABLED, "false");
const output = resolve("outputs/process-data-review-2026-09-15");
await mkdir(output, {recursive:true});
const db = new PrismaClient();
const secret = "process-review-local-only-secret";
const socket = createServer();
await new Promise(done => socket.listen(0, "127.0.0.1", done));
const port = socket.address().port;
await new Promise(done => socket.close(done));
const base = `http://127.0.0.1:${port}`;
const keepPreview = process.argv.includes("--preview");
let server, browser, passed = false;
try {
  await ensureTeacherReviewDemoFixture(db);
  const teacher = await db.user.findUniqueOrThrow({where:{user_id:"teacher_demo"}});
  const session = await db.assessmentSession.findUniqueOrThrow({where:{session_public_id:teacherReviewSessionPublicId}});
  await db.user.update({where:{id:session.user_db_id},data:{created_by_teacher_user_id:teacher.id}});
  const start = session.started_at;
  await db.processEvent.createMany({data:[
    {event_type:"page_visibility_hidden",offset:1000,payload:{browser_tab_id:"preview-tab"}},
    {event_type:"page_visibility_visible",offset:31000,payload:{browser_tab_id:"preview-tab"}},
    {event_type:"long_pause",offset:180000,pause_duration_ms:120000,payload:{}},
    ...Array.from({length:55},(_,index)=>({event_type:"typing_activity_summary",offset:200000+index*1000,payload:{key_count:4,backspace_count:1}}))
  ].map(({offset,...event})=>({...event,assessment_session_db_id:session.id,event_category:"navigation",event_source:"frontend",occurred_at:new Date(start.getTime()+offset)}))});
  const counts = async () => ({events:await db.processEvent.count(),packages:await db.responsePackage.count(),calls:await db.agentCall.count()});
  const before = await counts();
  const fd = openSync(`${output}/preview-server.log`, "w", 0o600);
  server = spawn(process.execPath,["node_modules/next/dist/bin/next","start","-H","127.0.0.1","-p",String(port)],{
    detached:keepPreview,stdio:["ignore",fd,fd],env:{...process.env,NODE_ENV:"production",APP_ENV:"development",
      SESSION_SECRET:secret,OPENAI_API_KEY:"",OPENAI_API_KEY_FILE:"",LLM_PROVIDER:"mock",LLM_LIVE_CALLS_ENABLED:"false",
      FORMATIVE_CONVERSATION_LIVE_CALLS_ENABLED:"false",OPERATIONAL_AGENT_MODE:"disabled",NEXT_TELEMETRY_DISABLED:"1",
      NODE_OPTIONS:`--import ${pathToFileURL(resolve("scripts/classroom-audit-network-guard.mjs")).href}`}
  });
  closeSync(fd);
  server.exited = new Promise(done => server.once("exit",done));
  let ready = false;
  for(let n=0;n<60;n++) {
    try {if((await fetch(`${base}/student/login`,{signal:AbortSignal.timeout(1000)})).ok){ready=true;break;}}catch{}
    await new Promise(done=>setTimeout(done,500));
  }
  assert(ready,"Local server did not start");
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1100},acceptDownloads:true});
  const now=Math.floor(Date.now()/1000);
  const payload=Buffer.from(JSON.stringify({user_db_id:teacher.id,user_id:teacher.user_id,role:teacher.role,auth_version:teacher.auth_version,iat:now,exp:now+3600})).toString("base64url");
  const signature=createHmac("sha256",secret).update(payload).digest("base64url");
  await context.addCookies([{name:"cmcq_session",value:`${payload}.${signature}`,url:base,httpOnly:true,sameSite:"Lax"}]);
  const errors=[];
  await context.route("**/*",route=>new URL(route.request().url()).origin===base ? route.continue() : route.abort());
  const page=await context.newPage();
  const requests=[];
  page.on("request", request=>requests.push(new URL(request.url()).pathname));
  page.on("pageerror",error=>errors.push(String(error)));
  const url=`${base}/teacher/sessions/${teacherReviewSessionPublicId}`;
  await page.goto(url);
  await page.getByRole("button",{name:"Process data",exact:true}).waitFor();
  const resourcePath=name=>`/api/teacher/sessions/${teacherReviewSessionPublicId}/${name}`;
  for(const name of ["item-responses","transcript","readable-transcript","response-packages","data-audit","process-events"]) {
    assert(!requests.includes(resourcePath(name)),`${name} must not load before its section is opened`);
  }
  let failAudit=true;
  await page.route(`**${resourcePath("data-audit")}`,route=> {
    if(failAudit) { failAudit=false; return route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:{code:"TEST_UNAVAILABLE",message:"Temporary review failure"}})}); }
    return route.continue();
  });
  await page.getByRole("button",{name:"Process data",exact:true}).click();
  await page.getByRole("button",{name:"Retry this section",exact:true}).click();
  await page.getByRole("heading",{name:"Activity timeline",exact:true}).waitFor();
  assert.equal(await page.getByRole("button",{name:"session evidence audit",exact:true}).count(),0);
  assert.equal(await page.getByRole("button",{name:"response packages",exact:true}).count(),0);
  await page.getByRole("combobox",{name:"Activity",exact:true}).selectOption("Typing");
  assert(await page.getByRole("button",{name:"Next page",exact:true}).isEnabled());
  await page.getByRole("button",{name:"Next page",exact:true}).click();
  assert(await page.getByRole("button",{name:"Previous page",exact:true}).isEnabled());
  await page.getByRole("button",{name:"Previous page",exact:true}).click();
  const downloadPromise=page.waitForEvent("download");
  await page.getByRole("button",{name:"Download process data",exact:true}).click();
  const download=await downloadPromise;
  assert.equal(download.suggestedFilename(),`${teacherReviewSessionPublicId}-process-data.json`);
  await download.saveAs(`${output}/preview-process-data.json`);
  const csvPromise=page.waitForEvent("download");
  await page.getByRole("button",{name:"Download timeline CSV",exact:true}).click();
  const csvDownload=await csvPromise;
  await csvDownload.saveAs(`${output}/preview-timeline.csv`);
  assert((await readFile(`${output}/preview-timeline.csv`,"utf8")).includes("recorded_at_utc"));
  await page.getByRole("combobox",{name:"Activity",exact:true}).selectOption("key_activity");
  await page.screenshot({path:`${output}/process-data-desktop.png`,fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:`${output}/process-data-mobile.png`,fullPage:true});
  await page.screenshot({path:`${output}/process-data-mobile-viewport.png`});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),"Page overflows mobile viewport");
  await page.setViewportSize({width:1440,height:1100});
  await page.getByRole("button",{name:"Assessment log",exact:true}).click();
  await page.getByRole("heading",{name:"Assessment log",exact:true}).waitFor();
  const filtered = page.waitForResponse(response => response.url().includes("/process-events?") && response.url().includes("event_type=page_visibility_hidden"));
  await page.getByRole("combobox",{name:"Event type",exact:true}).selectOption("page_visibility_hidden");
  assert.equal((await filtered).status(),200);
  await page.getByText("Loading assessment log",{exact:true}).waitFor({state:"hidden"});
  await page.getByRole("heading",{name:"Assessment page hidden",exact:true}).first().waitFor();
  await page.evaluate(()=>scrollTo(0,0));
  await page.waitForTimeout(100);
  await page.screenshot({path:`${output}/assessment-log-desktop.png`,fullPage:true});
  let delayed;
  let delayOnce=true;
  await page.route("**/process-events?**",async route=>{
    if(delayOnce && new URL(route.request().url()).searchParams.get("event_type")==="page_visibility_visible") {
      delayOnce=false;
      const response=await route.fetch();
      await new Promise(done=>{delayed=()=>route.fulfill({response}).then(done);});
    } else await route.continue();
  });
  await page.getByRole("combobox",{name:"Event type",exact:true}).selectOption("page_visibility_visible");
  for(let n=0;n<50 && !delayed;n++)await page.waitForTimeout(100);
  assert(delayed,"Expected a delayed filter request");
  const latest=page.waitForResponse(response=>response.url().includes("event_type=page_visibility_hidden"));
  await page.getByRole("combobox",{name:"Event type",exact:true}).selectOption("page_visibility_hidden");
  await latest;
  await delayed();
  await page.waitForTimeout(100);
  assert.equal(await page.getByRole("heading",{name:"Assessment page visible again",exact:true}).count(),0,"Stale filter results must not replace the current selection");
  await page.getByText("Structured conversation records",{exact:true}).first().click();
  await page.getByRole("heading",{name:"Structured conversation records",exact:true}).waitFor();
  await page.getByRole("button",{name:"Item responses",exact:true}).click();
  await page.locator("summary").filter({hasText:"Submission snapshots"}).click();
  assert(await page.getByText("Submission snapshots",{exact:false}).count()>0);
  await page.getByRole("button",{name:"Process data",exact:true}).click();
  await page.getByRole("heading",{name:"Activity timeline",exact:true}).waitFor();
  assert.equal(requests.filter(path=>path===resourcePath("data-audit")).length,2,"Loaded audit is reused across tabs after one failed request and retry");
  await page.getByRole("button",{name:"Refresh",exact:true}).last().click();
  await page.getByRole("heading",{name:"Activity timeline",exact:true}).waitFor();
  assert.equal(requests.filter(path=>path===resourcePath("data-audit")).length,3,"Refresh invalidates cached review data");
  assert.deepEqual(await counts(),before,"Read-only review must not create evidence or AI calls");
  assert.deepEqual(errors,[]);
  passed=true;
  await writeFile(`${output}/ux-result.json`,JSON.stringify({passed,preview_url:url,preview_pid:server.pid,checks:["desktop/mobile","no mobile overflow","filter and pagination","JSON and CSV downloads","consolidated tabs","lazy loading","section retry","stale filter protection","cache reuse and refresh","read-only record preservation","zero provider calls"]},null,2));
  console.log(JSON.stringify({passed,preview_url:url,screenshots:output}));
} finally {
  await browser?.close();
  if(keepPreview && passed)server.unref();
  else {
    if(server && server.exitCode===null){server.kill("SIGTERM");await server.exited;}
    await cleanupTeacherReviewDemoFixture(db);
  }
  await db.$disconnect();
}
