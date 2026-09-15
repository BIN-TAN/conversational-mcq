import assert from 'node:assert/strict';
import http from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright';

// Exercise the real hook and delivery client, without a database or provider.
const bundle = await build({
  stdin: {contents: `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {useStudentProcessEvents} from './src/components/student-assessment/process-events';
    function Capture({item, enabled}) {
      useStudentProcessEvents({sessionPublicId: 'browser-audit', currentItemPublicId: item, enabled});
      return <textarea aria-label="Response" />;
    }
    function App() {
      const [item, setItem] = useState('item-one');
      const [enabled, setEnabled] = useState(true);
      const [mounted, setMounted] = useState(true);
      return <><button onClick={() => setItem('item-two')}>Next item</button>
        <button onClick={() => setEnabled(v => !v)}>Toggle capture</button>
        <button onClick={() => setMounted(false)}>Leave</button>
        <button onClick={() => setMounted(true)}>Return</button>
        {mounted && <Capture item={item} enabled={enabled} />}</>;
    }
    createRoot(document.getElementById('root')).render(<App />);
  `, loader: 'tsx', resolveDir: process.cwd()},
  bundle: true, write: false, platform: 'browser', format: 'iife',
  define: {'process.env.NODE_ENV': '"test"', 'process.env.NEXT_PUBLIC_LONG_PAUSE_MS': '"120000"', 'process.env.NEXT_PUBLIC_INACTIVITY_MS': '"300000"'}
});
const records = [];
const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/student/sessions/browser-audit/events') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    records.push(...JSON.parse(Buffer.concat(chunks).toString()).events);
    res.writeHead(200, {'Content-Type': 'application/json'}).end('{}');
  } else if (req.url === '/app.js') {
    res.writeHead(200, {'Content-Type': 'text/javascript'}).end(bundle.outputFiles[0].text);
  } else {
    res.writeHead(200, {'Content-Type': 'text/html'}).end('<div id="root"></div><script src="/app.js"></script>');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({headless: true});
const checks = [];
const check = (name, pass) => checks.push({name, pass});
const settle = async page => {
  await page.waitForTimeout(500);
};
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
  await page.goto(base);
  const input = page.getByRole('textbox', {name: 'Response'});
  await input.waitFor();
  await page.reload();
  await input.waitFor();
  await settle(page);
  check('A real page reload produces one recovery event', records.filter(e => e.event_type === 'refresh_recovery').length === 1);
  const initialEntries = records.filter(e => e.payload?.reason === 'assessment_view_entered').length;
  await input.pressSequentially('private-answer');
  await input.press('Backspace');
  await page.getByRole('button', {name: 'Next item'}).click();
  await settle(page);
  check('Changing items does not count as another reload', records.filter(e => e.event_type === 'refresh_recovery').length === 1);
  check('Changing items does not count as a new assessment page entry', records.filter(e => e.payload?.reason === 'assessment_view_entered').length === initialEntries);
  check('Typing is attributed to the item just left', records.some(e => e.event_type === 'typing_activity_summary' && e.item_public_id === 'item-one' && e.payload.key_count === 15 && e.payload.backspace_count === 1));
  await input.pressSequentially('last-draft');
  await page.getByRole('button', {name: 'Toggle capture'}).click();
  await settle(page);
  check('Disabling capture sends the final typing summary', records.some(e => e.event_type === 'typing_activity_summary' && e.item_public_id === 'item-two' && e.payload.key_count === 10));
  await page.getByRole('button', {name: 'Toggle capture'}).click();
  await settle(page);
  check('Re-enabling capture does not count as another reload', records.filter(e => e.event_type === 'refresh_recovery').length === 1);
  await input.pressSequentially('unsent');
  await page.getByRole('button', {name: 'Leave', exact: true}).click();
  await settle(page);
  check('Unmounting sends the final typing summary', records.some(e => e.event_type === 'typing_activity_summary' && e.item_public_id === 'item-two' && e.payload.key_count === 6));
  check('Leaving the assessment records a view exit', records.some(e => e.payload?.reason === 'assessment_view_left'));
  const beforeReturn = records.filter(e => e.payload?.reason === 'assessment_view_entered').length;
  await page.getByRole('button', {name: 'Return', exact: true}).click();
  await settle(page);
  check('Returning records one new view entry', records.filter(e => e.payload?.reason === 'assessment_view_entered').length === beforeReturn + 1);
  check('Returning within the same document does not fabricate a reload', records.filter(e => e.event_type === 'refresh_recovery').length === 1);
  const returnedEntry = records.filter(e => e.payload?.reason === 'assessment_view_entered').at(-1);
  const precedingExit = records.filter(e => e.payload?.reason === 'assessment_view_left').at(-1);
  check('Document identity survives assessment component remount', returnedEntry.browser_tab_id === precedingExit.browser_tab_id);
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', {persisted: true}));
    window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true}));
    Object.defineProperty(document, 'visibilityState', {value:'hidden', configurable:true});
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', {value:'visible', configurable:true});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await settle(page);
  check('Browser document leave and cache return are recorded', records.some(e => e.payload?.reason === 'pagehide') && records.some(e => e.payload?.reason === 'pageshow_return'));
  check('Page hiding and return use canonical event names', records.some(e => e.event_type === 'page_visibility_hidden') && records.some(e => e.event_type === 'page_visibility_visible'));
  const serialized = JSON.stringify(records);
  check('No raw keystrokes or response text are captured', !['private-answer','last-draft','unsent'].some(value => serialized.includes(value)));
  check('Retransmissions preserve event identity and payload for server deduplication', records.every(event =>
    event.client_event_id && records.filter(e => e.client_event_id === event.client_event_id).every(e => JSON.stringify(e) === JSON.stringify(event))));
  check('No browser errors', errors.length === 0);
  console.log(JSON.stringify({checks, events: records.map(e => ({type: e.event_type, item: e.item_public_id, payload: e.payload})), errors}, null, 2));
  assert(checks.every(c => c.pass), 'Browser process-data contract failed');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
