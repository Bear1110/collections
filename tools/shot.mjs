// 用無頭 Edge（Windows）／Chrome 開網站、逐頁截圖（電腦 1280 寬＋手機 390 寬），並回報畫面上的錯誤。
// UI 改完一定跑一次，自己看截圖（見 docs/ui-guidelines.md）。
//
// 用法：
//   1. 先開本機伺服器：python -m http.server 8765 --bind 127.0.0.1（在專案資料夾裡）
//   2. node tools/shot.mjs <輸出資料夾> http://localhost:8765/ "#items" "#settings"
//      → <輸出資料夾>/d-items.png、m-items.png …，最後印出 console error
// 需要點按鈕、填表單的測試：複製這支，在 ★ 那段用 evalJS() 操作畫面。

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const [OUT, BASE = 'http://localhost:8765/', ...HASHES] = process.argv.slice(2);
if (!OUT) { console.error('用法：node tools/shot.mjs <輸出資料夾> <網址> "#頁面" …'); process.exit(1); }
mkdirSync(OUT, { recursive: true });
const BROWSER = process.env.BROWSER
  ?? (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : 'google-chrome');
const PORT = 9300 + Math.floor(Math.random() * 500); // 每次換一個，避免上次沒關乾淨的瀏覽器佔住
const browser = spawn(BROWSER, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${resolve(OUT, 'profile')}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let target;
for (let i = 0; i < 150 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* 還沒起來 */ }
  if (!target) await sleep(200);
}
if (!target) { console.error('瀏覽器沒有啟動'); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0;
const waiting = new Map();
const errors = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(m.params.entry.text);
});
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; waiting.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
/** 在頁面裡執行 JS（可以 await），回傳結果 */
export const evalJS = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) errors.push('eval: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
  return r.result?.result?.value;
};
const size = (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
const shot = async (name, full = true) => {
  await sleep(300);
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64'));
};

await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
await size(1280, 900);
await send('Page.navigate', { url: BASE });
await sleep(1500);
await evalJS('window.print = () => {}; window.confirm = () => true;'); // 列印、確認視窗不要卡住

// ★ 在這裡加操作，例如：await evalJS(`document.querySelector('[data-action=new-item]').click()`); await shot('d-new-item', false);

const hashes = HASHES.length ? HASHES : ['#'];
for (const [w, h, prefix] of [[1280, 900, 'd'], [390, 844, 'm']]) {
  await size(w, h);
  for (const hash of hashes) {
    await evalJS(`location.hash = ${JSON.stringify(hash)}`);
    await sleep(400);
    await shot(`${prefix}-${hash.replace(/[^a-z0-9]+/gi, '') || 'home'}`);
  }
  if (prefix === 'm') console.log('手機有沒有左右捲動：', await evalJS('document.documentElement.scrollWidth > window.innerWidth'));
}
console.log('錯誤：', errors.length ? errors.join('\n') : '無');
ws.close();
browser.kill();
process.exit(errors.length ? 1 : 0);
