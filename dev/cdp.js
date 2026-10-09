// Drives a dev run of Flock (started with --remote-debugging-port=9339)
// through the Chrome DevTools Protocol. For testing only.
//   node dev/cdp.js targets
//   node dev/cdp.js eval <island|settings> "<expression>"
//   node dev/cdp.js shot <island|settings> <out.png>
const fs = require('fs');

const PORT = process.env.FLOCK_CDP_PORT || 9339;

async function list() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return r.json();
}

async function connect(match) {
  const t = (await list()).find((x) => x.type === 'page' && x.url.includes(match));
  if (!t) throw new Error(`no page matching "${match}"`);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  return { send, close: () => ws.close() };
}

(async () => {
  const [cmd, which, arg] = process.argv.slice(2);
  if (cmd === 'targets') {
    for (const t of await list()) console.log(t.type, t.title, t.url);
    return;
  }
  const c = await connect(which === 'settings' ? 'settings' : 'island');
  if (cmd === 'eval') {
    const r = await c.send('Runtime.evaluate', { expression: arg, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) console.log('EXCEPTION', JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails));
    else console.log(JSON.stringify(r.result.result.value, null, 2));
  } else if (cmd === 'shot') {
    const r = await c.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(arg, Buffer.from(r.result.data, 'base64'));
    console.log('saved', arg);
  }
  c.close();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
