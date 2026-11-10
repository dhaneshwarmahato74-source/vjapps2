'use strict';
/*
 * DK EDITS VJ PLAYER – desktop wrapper (Windows + macOS)
 *  - Opens ONE fixed URL (app.config.json) in its own window: no address bar, no tabs, no way to browse elsewhere.
 *  - "Output" pop-up of the player is placed fullscreen on the extended display automatically.
 *  - Keeps rendering when hidden/behind other windows, blocks sleep.
 *  - Kill-switch: if the URL is gone / switched off / expired, only a screen with "Uninstall" is shown.
 *  - Optional mode "local": runs the bundled Art-Net bridge inside the app (offline, Tiger Touch works).
 */
const { app, BrowserWindow, Menu, dialog, ipcMain, shell, screen, session, powerSaveBlocker, net, utilityProcess, systemPreferences } = require('electron');
const crypto = require('crypto');
const { Readable } = require('stream');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn, execFile } = require('child_process');

const DEFAULTS = { appName: 'DK EDITS VJ PLAYER', mode: 'online', appUrl: '', localPort: 18080, statusUrl: '', expiresOn: '', autoOpenOutput: true, cacheVideos: true, videoCacheMaxMB: 4000, forceExtend: true, controllerFullscreen: false, statusCheckMinutes: 5 };
let cfg = DEFAULTS;
try { cfg = Object.assign({}, DEFAULTS, JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app.config.json'), 'utf8'))); } catch (e) { /* defaults */ }

// keep video/canvas running when the window is behind another one or on a second screen
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-background-timer-throttling');

if (!app.requestSingleInstanceLock()) { app.quit(); }

let mainWin = null;
let bridge = null;
let target = '';            // the one URL this app is allowed to show
let blocked = false;
let activeMode = '';
let psb = null, psb2 = null;
let statusTimer = null;
const outputs = new Set();

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

// ---------------------------------------------------------------- helpers
function originOf(u) { try { return new URL(u).origin; } catch (e) { return ''; } }
function allowedUrl(u) {
  if (!u) return false;
  if (u.startsWith('file:') || u.startsWith('about:blank') || u.startsWith('blob:')) return true;
  return originOf(u) === originOf(target);
}
function playerRoot() { return app.isPackaged ? path.join(process.resourcesPath, 'player') : path.join(__dirname, '..', 'player'); }
function expired() { return cfg.expiresOn && Date.now() > Date.parse(cfg.expiresOn + 'T23:59:59'); }

function httpUp(port) {
  return new Promise((resolve) => {
    const r = http.get({ host: '127.0.0.1', port, path: '/', timeout: 800 }, (res) => { res.resume(); resolve(res.statusCode < 500); });
    r.on('error', () => resolve(false)); r.on('timeout', () => { r.destroy(); resolve(false); });
  });
}
async function waitForPort(port, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await httpUp(port)) return true; await new Promise((r) => setTimeout(r, 250)); }
  return false;
}

// ---------------------------------------------------------------- local bridge (mode: "local")
function siteDir() { return path.join(app.getPath('userData'), 'site'); }
function startBridge() {
  const root = playerRoot();
  const userCfg = path.join(app.getPath('userData'), 'config.json');
  try {
    if (!fs.existsSync(userCfg)) { fs.mkdirSync(path.dirname(userCfg), { recursive: true }); fs.copyFileSync(path.join(root, 'config', 'config.json'), userCfg); }
  } catch (e) { /* bridge creates defaults */ }
  bridge = utilityProcess.fork(path.join(root, 'bridge', 'server.js'), ['--port', String(cfg.localPort)], {
    env: Object.assign({}, process.env, { DLS_CONFIG: userCfg, DLS_WEB_OVERLAY: siteDir() }), stdio: 'ignore'
  });
}
function stopBridge() { try { if (bridge) bridge.kill(); } catch (e) { /* ignore */ } bridge = null; }

// ---------------------------------------------------------------- kill switch
async function checkStatus() {
  if (expired()) return { ok: false, kind: 'expired' };
  if (!cfg.statusUrl) return { ok: true };
  try {
    const r = await net.fetch(cfg.statusUrl + (cfg.statusUrl.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return { ok: true };                     // file missing = no kill-switch set
    const j = await r.json();
    if (j.enabled === false) return { ok: false, kind: 'disabled', msg: j.message };
    if (j.expiresOn && Date.now() > Date.parse(j.expiresOn + 'T23:59:59')) return { ok: false, kind: 'expired', msg: j.message };
  } catch (e) { /* offline / bad json: never kill a running show because of a network blip */ }
  return { ok: true };
}

function showBlocked(kind, msg) {
  blocked = true;
  for (const w of Array.from(outputs)) { try { w.destroy(); } catch (e) { /* ignore */ } }
  outputs.clear();
  if (!mainWin || mainWin.isDestroyed()) return;
  if (mainWin.isFullScreen()) mainWin.setFullScreen(false);
  const query = { kind }; if (msg) query.msg = msg;
  mainWin.loadFile(path.join(__dirname, 'blocked.html'), { query });
}

// ---------------------------------------------------------------- uninstall
async function uninstall() {
  const { response } = await dialog.showMessageBox(mainWin && !mainWin.isDestroyed() ? mainWin : undefined, {
    type: 'warning', buttons: ['Uninstall', 'Cancel'], defaultId: 1, cancelId: 1,
    message: 'Uninstall ' + cfg.appName + '?', detail: 'The app and its saved data will be removed from this computer.'
  });
  if (response !== 0) return;
  if (!app.isPackaged) { dialog.showErrorBox('Uninstall', 'Development run – nothing is installed.'); return; }
  stopBridge();
  if (isWin) {
    const dir = path.dirname(process.execPath);
    const un = fs.readdirSync(dir).find((f) => /^uninstall.*\.exe$/i.test(f));
    if (!un) { dialog.showErrorBox('Uninstall', 'Uninstaller not found. Use Windows Settings → Apps → ' + cfg.appName + ' → Uninstall.'); return; }
    app.once('quit', () => { try { spawn(path.join(dir, un), [], { detached: true, stdio: 'ignore' }).unref(); } catch (e) { /* ignore */ } });
    app.quit();
  } else if (isMac) {
    const bundle = path.resolve(process.execPath, '..', '..', '..');
    try { await shell.trashItem(bundle); }
    catch (e) { dialog.showErrorBox('Uninstall', 'Could not move the app to the Trash (' + e.message + '). Drag it from Applications to the Trash yourself.'); return; }
    try { fs.rmSync(app.getPath('userData'), { recursive: true, force: true }); } catch (e) { /* ignore */ }
    app.quit();
  } else {
    dialog.showErrorBox('Uninstall', 'Please remove the app with your package manager.');
  }
}

ipcMain.handle('dk:uninstall', (e) => { if (e.senderFrame.url.startsWith('file:')) return uninstall(); });
ipcMain.handle('dk:retry', (e) => { if (e.senderFrame.url.startsWith('file:')) return load(); });
ipcMain.handle('dk:quit', (e) => { if (e.senderFrame.url.startsWith('file:')) app.quit(); });

// ---------------------------------------------------------------- make sure the 2nd screen is in "Extend" mode
// Windows: DisplaySwitch /extend (same as Win+P → Extend). Mac: helper turns "Mirror Displays" off. No-op with one screen / already extended.
function forceExtend() {
  if (!cfg.forceExtend || screen.getAllDisplays().length >= 2) return;
  try {
    if (isWin) {
      const ds = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'DisplaySwitch.exe');
      if (fs.existsSync(ds)) spawn(ds, ['/extend'], { windowsHide: true, stdio: 'ignore' }).unref();
    } else if (isMac) {
      const bin = app.isPackaged ? path.join(process.resourcesPath, 'dk-unmirror') : path.join(__dirname, '..', 'build', 'mac', 'dk-unmirror');
      if (fs.existsSync(bin)) execFile(bin, [], () => {});
    }
  } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- output window → extended display
function otherDisplay() {
  if (!mainWin || mainWin.isDestroyed()) return null;
  if (process.env.DK_FAKE_SECOND) return { id: 999, bounds: { x: 1920, y: 0, width: 1280, height: 720 } }; // test only
  const all = screen.getAllDisplays();
  if (all.length < 2) return null;
  const here = screen.getDisplayMatching(mainWin.getBounds());
  const others = all.filter((d) => d.id !== here.id);
  return others.find((d) => d.id !== screen.getPrimaryDisplay().id) || others[0];
}

function wireChild(win, url) {
  win.webContents.setWindowOpenHandler(childOpenHandler);
  if (!/output\.html/.test(url)) return;
  outputs.add(win);
  win.on('closed', () => { outputs.delete(win); if (!blocked) userClosed = true; });
  const d = otherDisplay();
  if (!d) return;                                  // only one screen for now: normal window; moved later by the watcher
  placeOutput(win, d);
}

function childOpenHandler({ url }) {
  if (!allowedUrl(url)) { return { action: 'deny' }; }
  const out = /output\.html/.test(url);
  const d = out ? otherDisplay() : null;
  const opts = { autoHideMenuBar: true, backgroundColor: out ? '#000000' : '#090e15', webPreferences: { backgroundThrottling: false, preload: path.join(__dirname, 'preload.js') } };
  if (out) { opts.frame = !d; if (d) Object.assign(opts, { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height }); }
  return { action: 'allow', overrideBrowserWindowOptions: opts };
}

function clickOutput() {
  if (blocked || !mainWin || mainWin.isDestroyed()) return;
  // clicking the player's own "Output" button keeps window.opener, so the live canvas mirror works
  mainWin.webContents.executeJavaScript("(function(){var b=document.querySelector('#btnOutput');if(b){b.click();return true}return false})()", true).catch(() => {});
}
function autoOpenOutput() { userClosed = false; if (!outputs.size) clickOutput(); }

// Runs every 2 s: opens the output as soon as the player is loaded (even with one screen), and moves it
// fullscreen onto the extended display the moment one exists. If the user closes it on purpose it stays closed
// until a display is plugged in again or the menu item is used.
let watcher = null, userClosed = false;
function placeOutput(win, d) {
  if (win.isDestroyed()) return;
  win.setBounds(d.bounds);
  win.setAlwaysOnTop(true, 'screen-saver');
  if (isMac) win.setSimpleFullScreen(true); else win.setFullScreen(true);
  win.dkPlaced = true;
}
function armOutputWatcher() {
  if (!cfg.autoOpenOutput) return;
  userClosed = false;
  if (watcher) return;
  watcher = setInterval(() => {
    if (blocked || !mainWin || mainWin.isDestroyed() || mainWin.webContents.isLoading()) return;
    const d = otherDisplay();
    if (!outputs.size) { if (!userClosed) clickOutput(); return; }
    if (d) for (const w of outputs) if (!w.dkPlaced) placeOutput(w, d);
  }, 2000);
}

// ---------------------------------------------------------------- main window
function createMain() {
  mainWin = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600, show: false, backgroundColor: '#090e15',
    title: cfg.appName, icon: path.join(__dirname, '..', 'build', 'icon.png'),
    fullscreen: !!cfg.controllerFullscreen,
    webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.js') }
  });
  mainWin.once('ready-to-show', () => { mainWin.show(); mainWin.maximize(); });
  mainWin.setMenuBarVisibility(false);
  mainWin.on('page-title-updated', (e) => e.preventDefault());

  mainWin.webContents.setWindowOpenHandler(childOpenHandler);
  mainWin.webContents.on('did-create-window', (win, details) => wireChild(win, details.url));
  mainWin.webContents.on('will-navigate', (e, url) => { if (!allowedUrl(url)) e.preventDefault(); });
  mainWin.webContents.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (!isMain || code === -3 || blocked || !url || url.startsWith('file:')) return;
    if (cfg.mode === 'auto' && !forced && activeMode === 'online') { autoFallback = true; load(); return; }
    showBlocked('offline');
  });
  mainWin.webContents.on('did-finish-load', () => { if (!blocked) armOutputWatcher(); if (!blocked && activeMode === 'online') setTimeout(() => syncSite('load'), 6000); });
  mainWin.on('closed', () => { mainWin = null; app.quit(); });
}

let forced = null;          // 'online' | 'local' | null(=app.config.json mode), chosen from the View menu
let autoFallback = false;   // online page died while running in "auto" mode -> go offline once
async function fetchTimeout(url, ms) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try { return await net.fetch(url, { cache: 'no-store', signal: ac.signal }); } finally { clearTimeout(t); }
}
// ---------------------------------------------------------------- offline copy of the LIVE website
// While online the app saves the website's files (page, scripts, css, images, clips.js ...) to its own folder.
// The offline mode (bridge, Tiger Touch) then serves that saved copy, so website updates reach it without a new installer.
let syncing = false, lastSync = 0;
function skipRef(r) { return !r || /^(data:|blob:|mailto:|tel:|javascript:|#|\/\/)/i.test(r) || /^[a-z]+:/i.test(r) && !/^https?:/i.test(r); }
async function syncSite(why) {
  if (process.env.DK_DEBUG) console.log('SYNC START', why, 'syncing=' + syncing, 'blocked=' + blocked, 'mode=' + cfg.mode, 'forced=' + forced, 'active=' + activeMode);
  if (syncing || blocked || !cfg.appUrl || cfg.mode === 'local' || (forced === 'local')) return;
  syncing = true;
  const base = new URL(cfg.appUrl), tmp = siteDir() + '.new';
  try {
    fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
    const queue = ['', 'index.html', 'output.html', 'mapper.html', 'admin.html', 'manifest.webmanifest', 'sw.js'];
    try {                                      // everything the live page really loaded (also dynamic files)
      if (mainWin && !mainWin.isDestroyed() && activeMode === 'online') {
        const names = await mainWin.webContents.executeJavaScript("performance.getEntriesByType('resource').map(function(e){return e.name})");
        for (const n of names) queue.push(n);
      }
    } catch (e) { /* ignore */ }
    const seen = new Set(); let total = 0, count = 0;
    while (queue.length) {
      const ref = queue.shift(); if (skipRef(ref)) continue;
      let u; try { u = new URL(ref, base); } catch (e) { continue; }
      u.hash = '';
      if (u.origin !== base.origin || !u.pathname.startsWith(base.pathname)) continue;
      let rel = decodeURIComponent(u.pathname.slice(base.pathname.length));
      if (rel === '' || rel.endsWith('/')) rel += 'index.html';
      if (/^(api|ws|media)(\/|$)/.test(rel) || /\.(mp4|webm|m4v|mov|mkv)$/i.test(rel) || rel.includes('..') || seen.has(rel)) continue;
      seen.add(rel);
      let r; try { r = await fetchTimeout(u.href, 30000); } catch (e) { r = null; }
      if (!r || !r.ok) { if (rel === 'index.html') throw new Error('index.html not reachable'); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      total += buf.length; if (total > 80 * 1024 * 1024) throw new Error('site too big');
      const out = path.join(tmp, rel); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, buf); count++;
      const ext = path.extname(rel).toLowerCase();
      if (ext === '.html' || ext === '.htm') { for (const m of buf.toString('utf8').matchAll(/(?:src|href)\s*=\s*["']([^"'#]+)["']/gi)) queue.push(new URL(m[1], u).href); }
      if (ext === '.css') { for (const m of buf.toString('utf8').matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) queue.push(new URL(m[1], u).href); }
    }
    if (!seen.has('index.html') || !fs.existsSync(path.join(tmp, 'index.html'))) throw new Error('no index.html');
    fs.writeFileSync(path.join(tmp, '.synced.json'), JSON.stringify({ at: new Date().toISOString(), url: cfg.appUrl, files: count }));
    fs.rmSync(siteDir(), { recursive: true, force: true }); fs.renameSync(tmp, siteDir());
    lastSync = Date.now();
    if (mainWin && !mainWin.isDestroyed() && activeMode === 'online') mainWin.setTitle(cfg.appName + '  —  ONLINE  (offline copy updated ' + new Date().toLocaleTimeString() + ')');
    if (process.env.DK_DEBUG) console.log('SYNC OK', why, count, 'files');
  } catch (e) {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (x) { /* ignore */ }   // keep the previous good copy
    if (process.env.DK_DEBUG) console.log('SYNC FAIL', e.message);
  }
  syncing = false;
}

function closeOutputs() { for (const w of Array.from(outputs)) { try { w.destroy(); } catch (e) { /* ignore */ } } outputs.clear(); userClosed = false; }

async function load(force) {
  if (force) forced = force === 'auto' ? null : force;
  blocked = false;
  if (!mainWin || mainWin.isDestroyed()) return;
  const st = await checkStatus();
  if (!st.ok) return showBlocked(st.kind, st.msg);

  let mode = autoFallback ? 'local' : (forced || cfg.mode);   // 'auto' | 'online' | 'local'
  autoFallback = false;
  if (mode !== 'local') {
    let r = null;
    if (cfg.appUrl) { try { r = await fetchTimeout(cfg.appUrl, 6000); } catch (e) { r = null; } }
    if (r && (r.status === 404 || r.status === 410)) return showBlocked('removed');   // URL taken down = switched off
    if (r && r.ok) mode = 'online';
    else if (mode === 'auto') mode = 'local';                                         // no internet -> bundled offline copy
    else return showBlocked('offline');
  }
  closeOutputs();
  if (mode === 'local') {
    if (!bridge) startBridge();
    target = 'http://127.0.0.1:' + cfg.localPort + '/';
    if (!(await waitForPort(cfg.localPort, 20000))) return showBlocked('offline', 'Local player could not start (port ' + cfg.localPort + ' busy?).');
  } else {
    target = cfg.appUrl;
  }
  activeMode = mode;
  mainWin.setTitle(cfg.appName + (mode === 'local' ? '  —  OFFLINE copy' : '  —  ONLINE'));
  mainWin.loadURL(target);
}

// ---------------------------------------------------------------- video cache (bunny.net etc.)
// Every video file (.mp4/.webm/.m4v/.mov) the page plays from another server is saved on this computer the first time
// it is played; later plays come from the local file (smooth, no stutter, no re-download). Internet is still needed for
// the first download and for the website itself.
const VIDEO_RE = /\.(mp4|webm|m4v|mov)$/i;
const vcDir = () => path.join(app.getPath('userData'), 'videocache');
const downloading = new Map(), revalidated = new Set();
const vcKey = (u) => crypto.createHash('sha1').update(u.origin + u.pathname).digest('hex');
function vcCacheable(request) {
  if (!cfg.cacheVideos || request.method !== 'GET') return null;
  let u; try { u = new URL(request.url); } catch (e) { return null; }
  if (!VIDEO_RE.test(u.pathname)) return null;
  if (target && u.origin === originOf(target)) return null;                       // the site's own files are handled elsewhere
  if (/^(127\.0\.0\.1|localhost)$/.test(u.hostname) && u.port === String(cfg.localPort)) return null;
  return u;
}
function vcMeta(key) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(vcDir(), key + '.json'), 'utf8'));
    return m.complete && fs.statSync(path.join(vcDir(), key + '.bin')).size === m.size ? m : null;
  } catch (e) { return null; }
}
function vcRemove(key) { for (const x of ['.bin', '.json', '.part']) { try { fs.rmSync(path.join(vcDir(), key + x), { force: true }); } catch (e) { /* ignore */ } } }
function vcTrim(keep) {
  try {
    const max = Math.max(200, cfg.videoCacheMaxMB || 4000) * 1024 * 1024;
    const files = fs.readdirSync(vcDir()).filter((f) => f.endsWith('.bin')).map((f) => { const st = fs.statSync(path.join(vcDir(), f)); return { key: f.slice(0, -4), size: st.size, t: st.mtimeMs }; });
    let sum = files.reduce((a, f) => a + f.size, 0);
    for (const f of files.sort((a, b) => a.t - b.t)) { if (sum <= max) break; if (f.key === keep) continue; vcRemove(f.key); sum -= f.size; }
  } catch (e) { /* ignore */ }
}
function vcDownload(key, url) {
  if (downloading.has(key)) return;
  const part = path.join(vcDir(), key + '.part');
  const job = (async () => {
    fs.mkdirSync(vcDir(), { recursive: true });
    const r = await net.fetch(url, { bypassCustomProtocolHandlers: true, cache: 'no-store' });
    if (r.status !== 200 || !r.body) throw new Error('HTTP ' + r.status);
    const len = Number(r.headers.get('content-length')) || 0;
    await new Promise((res, rej) => { const ws = fs.createWriteStream(part), rs = Readable.fromWeb(r.body); rs.on('error', rej); ws.on('error', rej); ws.on('finish', res); rs.pipe(ws); });
    const size = fs.statSync(part).size;
    if (!size || (len && size !== len)) throw new Error('incomplete download');
    fs.renameSync(part, path.join(vcDir(), key + '.bin'));
    fs.writeFileSync(path.join(vcDir(), key + '.json'), JSON.stringify({ complete: true, size, url: url.split('?')[0], type: r.headers.get('content-type') || '', etag: r.headers.get('etag') || '', lm: r.headers.get('last-modified') || '', at: Date.now() }));
    vcTrim(key);
    if (process.env.DK_DEBUG) console.log('VCACHE saved', url, size);
  })().catch((e) => { try { fs.rmSync(part, { force: true }); } catch (x) { /* ignore */ } if (process.env.DK_DEBUG) console.log('VCACHE fail', e.message); }).finally(() => downloading.delete(key));
  downloading.set(key, job);
}
function vcRevalidate(key, url, meta) {          // once per run: if the file on the server changed, drop our copy
  if (revalidated.has(key)) return; revalidated.add(key);
  net.fetch(url, { method: 'HEAD', bypassCustomProtocolHandlers: true, cache: 'no-store' }).then((r) => {
    if (!r.ok) return;
    const len = Number(r.headers.get('content-length')) || 0, et = r.headers.get('etag') || '', lm = r.headers.get('last-modified') || '';
    if ((len && len !== meta.size) || (et && meta.etag && et !== meta.etag) || (lm && meta.lm && lm !== meta.lm)) vcRemove(key);
  }).catch(() => { /* offline: keep using the saved copy */ });
}
function vcFileResponse(file, meta, range) {
  const size = meta.size; let start = 0, end = size - 1, status = 200;
  const m = /bytes=(\d*)-(\d*)/.exec(range || '');
  if (m) {
    if (m[1] !== '') { start = +m[1]; if (m[2] !== '') end = Math.min(+m[2], size - 1); } else if (m[2] !== '') start = Math.max(0, size - +m[2]);
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
    status = 206;
  }
  const h = { 'Content-Type': meta.type || (/\.webm/i.test(meta.url || '') ? 'video/webm' : 'video/mp4'), 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1), 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' };
  if (status === 206) h['Content-Range'] = 'bytes ' + start + '-' + end + '/' + size;
  return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), { status, headers: h });
}
async function vcHandle(request, u) {
  const key = vcKey(u), meta = vcMeta(key);
  if (meta) {
    const file = path.join(vcDir(), key + '.bin');
    try { const now = new Date(); fs.utimesSync(file, now, now); } catch (e) { /* ignore */ }
    vcRevalidate(key, request.url, meta);
    return vcFileResponse(file, meta, request.headers.get('range'));
  }
  vcDownload(key, request.url);                                     // save it in the background ...
  return net.fetch(request, { bypassCustomProtocolHandlers: true }); // ... and play from the server right now
}
// ---------------------------------------------------------------- Appwrite video list: saved so everything works without internet
// When online: the list of video links is saved and ALL its videos are downloaded in the background (video cache).
// When offline: the saved list is served instead.
const LIST_RE = /\/(tablesdb\/[^/]+\/tables|databases\/[^/]+\/collections)\/[^/]+\/(rows|documents)$/;
const listDir = () => path.join(app.getPath('userData'), 'listcache');
function listFile(url) { return path.join(listDir(), crypto.createHash('sha1').update(url).digest('hex') + '.json'); }
function prefetchVideos(buf) {
  try {
    const j = JSON.parse(buf.toString('utf8'));
    for (const row of (j.rows || j.documents || [])) {
      let u; try { u = new URL(row.url); } catch (e) { continue; }
      if (!/^https?:$/.test(u.protocol) || !VIDEO_RE.test(u.pathname)) continue;
      const key = vcKey(u); if (!vcMeta(key)) vcDownload(key, row.url);
    }
  } catch (e) { /* ignore */ }
}
async function listPass(request) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
  if (request.method === 'OPTIONS') {
    try { return await net.fetch(request, { bypassCustomProtocolHandlers: true }); } catch (e) { return new Response(null, { status: 204, headers: cors }); }
  }
  const file = listFile(request.url);
  try {
    const r = await net.fetch(request, { bypassCustomProtocolHandlers: true });
    if (r.ok && cfg.cacheVideos !== false) {
      const buf = Buffer.from(await r.clone().arrayBuffer());
      try { fs.mkdirSync(listDir(), { recursive: true }); fs.writeFileSync(file, buf); } catch (e) { /* ignore */ }
      prefetchVideos(buf);
    }
    return r;
  } catch (e) {
    try { return new Response(fs.readFileSync(file), { status: 200, headers: Object.assign({ 'Content-Type': 'application/json' }, cors) }); } catch (x) { throw e; }
  }
}

async function videoCacheDialog() {
  let n = 0, bytes = 0;
  try { for (const f of fs.readdirSync(vcDir())) if (f.endsWith('.bin')) { n++; bytes += fs.statSync(path.join(vcDir(), f)).size; } } catch (e) { /* empty */ }
  const { response } = await dialog.showMessageBox(mainWin && !mainWin.isDestroyed() ? mainWin : undefined, {
    type: 'info', buttons: ['OK', 'Clear video cache'], defaultId: 0, cancelId: 0, message: 'Saved videos: ' + n + ' (' + (bytes / 1048576).toFixed(0) + ' MB)',
    detail: 'Videos are saved here the first time they play, so later plays are smooth. Limit: ' + (cfg.videoCacheMaxMB || 4000) + ' MB.'
  });
  if (response === 1) { try { fs.rmSync(vcDir(), { recursive: true, force: true }); fs.rmSync(listDir(), { recursive: true, force: true }); } catch (e) { /* ignore */ } revalidated.clear(); }
}

// ---------------------------------------------------------------- app lifecycle
function buildMenu() {
  const tpl = [
    ...(isMac ? [{ label: cfg.appName, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: 'View', submenu: [
      { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => load() },
      { label: 'Use online website', click: () => load('online') },
      { label: 'Use offline copy (Tiger Touch / no internet)', click: () => load('local') },
      { label: 'Auto (online if available, else offline)', click: () => load('auto') },
      { label: 'Update offline copy now', click: () => syncSite('menu') },
      { label: 'Saved videos (video cache)…', click: () => videoCacheDialog() },
      { type: 'separator' },
      { label: 'Toggle full screen', accelerator: isMac ? 'Ctrl+Cmd+F' : 'F11', click: () => { if (mainWin) mainWin.setFullScreen(!mainWin.isFullScreen()); } },
      { label: 'Open output on extended screen', accelerator: 'CmdOrCtrl+Shift+O', click: () => autoOpenOutput() }
    ] },
    { label: 'Help', submenu: [
      { label: 'Uninstall ' + cfg.appName + '…', click: () => uninstall() },
      ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit' }])
    ] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

app.whenReady().then(async () => {
  const pass = async (request) => {
    if ((request.method === 'GET' || request.method === 'OPTIONS') && LIST_RE.test(new URL(request.url).pathname)) { try { return await listPass(request); } catch (e) { /* fall through */ } }
    const u = vcCacheable(request);
    if (u) { try { return await vcHandle(request, u); } catch (e) { /* fall through to the server */ } }
    return net.fetch(request, { bypassCustomProtocolHandlers: true });
  };
  session.defaultSession.protocol.handle('https', pass);
  if (process.env.DK_TEST_HTTP) session.defaultSession.protocol.handle('http', pass);   // test only
  const okPerms = new Set(['media', 'audioCapture', 'window-management', 'window-placement', 'fullscreen', 'clipboard-sanitized-write']);
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, perm, cb, details) => cb(okPerms.has(perm) && allowedUrl((details && details.requestingUrl) || wc.getURL())));
  ses.setPermissionCheckHandler((wc, perm, origin) => okPerms.has(perm) && allowedUrl(origin));

  if (isMac) { try { await systemPreferences.askForMediaAccess('microphone'); } catch (e) { /* ignore */ } }
  psb = powerSaveBlocker.start('prevent-display-sleep');   // screen + laptop stay awake, no screensaver
  psb2 = powerSaveBlocker.start('prevent-app-suspension'); // system never suspends while the app is open
  forceExtend();
  setTimeout(forceExtend, 6000);
  buildMenu();
  createMain();
  load();

  setInterval(() => { if (activeMode === 'online' && Date.now() - lastSync > 20 * 60 * 1000) syncSite('timer'); }, 5 * 60 * 1000);
  const mins = Math.max(1, cfg.statusCheckMinutes || 5);
  statusTimer = setInterval(async () => {
    if (blocked) return;
    const st = await checkStatus();
    if (!st.ok) showBlocked(st.kind, st.msg);
  }, mins * 60 * 1000);

  screen.on('display-added', () => setTimeout(armOutputWatcher, 1000));
  
});

app.on('second-instance', () => { if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); } });
app.on('before-quit', () => { stopBridge(); if (statusTimer) clearInterval(statusTimer); if (psb !== null) powerSaveBlocker.stop(psb); if (psb2 !== null) powerSaveBlocker.stop(psb2); });
app.on('window-all-closed', () => app.quit());
