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
  await input.pressSequentially('private-answer');
  await input.press('Backspace');
  await page.getByRole('button', {name: 'Next item'}).click();
  await settle(page);
  check('Changing items does not count as another reload', records.filter(e => e.event_type === 'refresh_recovery').length === 1);
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
