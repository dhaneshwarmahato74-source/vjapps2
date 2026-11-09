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
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn, execFile } = require('child_process');

const DEFAULTS = { appName: 'DK EDITS VJ PLAYER', mode: 'online', appUrl: '', localPort: 18080, statusUrl: '', expiresOn: '', autoOpenOutput: true, forceExtend: true, controllerFullscreen: false, statusCheckMinutes: 5 };
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
function startBridge() {
  const root = playerRoot();
  const userCfg = path.join(app.getPath('userData'), 'config.json');
  try {
    if (!fs.existsSync(userCfg)) { fs.mkdirSync(path.dirname(userCfg), { recursive: true }); fs.copyFileSync(path.join(root, 'config', 'config.json'), userCfg); }
  } catch (e) { /* bridge creates defaults */ }
  bridge = utilityProcess.fork(path.join(root, 'bridge', 'server.js'), ['--port', String(cfg.localPort)], {
    env: Object.assign({}, process.env, { DLS_CONFIG: userCfg }), stdio: 'ignore'
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

  mainWin.webContents.setWindowOpenHandler(childOpenHandler);
  mainWin.webContents.on('did-create-window', (win, details) => wireChild(win, details.url));
  mainWin.webContents.on('will-navigate', (e, url) => { if (!allowedUrl(url)) e.preventDefault(); });
  mainWin.webContents.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (isMain && code !== -3 && !blocked && url && !url.startsWith('file:')) showBlocked('offline');
  });
  mainWin.webContents.on('did-finish-load', () => { if (!blocked) armOutputWatcher(); });
  mainWin.on('closed', () => { mainWin = null; app.quit(); });
}

async function load() {
  blocked = false;
  if (!mainWin || mainWin.isDestroyed()) return;
  const st = await checkStatus();
  if (!st.ok) return showBlocked(st.kind, st.msg);

  if (cfg.mode === 'local') {
    if (!bridge) startBridge();
    target = 'http://127.0.0.1:' + cfg.localPort + '/';
    if (!(await waitForPort(cfg.localPort, 20000))) return showBlocked('offline', 'Local player could not start (port ' + cfg.localPort + ' busy?).');
  } else {
    target = cfg.appUrl;
    try {
      const r = await net.fetch(target, { method: 'GET', cache: 'no-store' });
      if (r.status === 404 || r.status === 410) return showBlocked('removed');
      if (!r.ok) return showBlocked('offline');
    } catch (e) { return showBlocked('offline'); }
  }
  mainWin.loadURL(target);
}

// ---------------------------------------------------------------- app lifecycle
function buildMenu() {
  const tpl = [
    ...(isMac ? [{ label: cfg.appName, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: 'View', submenu: [
      { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => load() },
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
