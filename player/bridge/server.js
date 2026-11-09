#!/usr/bin/env node
'use strict';
/*
 * Diamond LED Strobe – local bridge
 *  - receives Art-Net (UDP 6454) from the Avolites Tiger Touch II over Ethernet
 *  - serves the web app over HTTP and pushes DMX frames to it over WebSocket
 *  - stores config/config.json, lists network interfaces, optional ffmpeg WebM->MP4 conversion
 * No npm dependencies. Node 18+.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const { ArtNetReceiver, ipv4Interfaces } = require('./artnet');
const { WSServer } = require('./ws');

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const CONFIG_PATH = process.env.DLS_CONFIG || path.join(ROOT, 'config', 'config.json');
const PROFILES_PATH = path.join(ROOT, 'config', 'fixture-profiles.json');
const args = process.argv.slice(2);
const flag = (n) => args.includes('--' + n);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const DEFAULT_CONFIG = {
  server: { httpHost: '127.0.0.1', httpPort: 8080 },
  artnet: { bindAddress: '0.0.0.0', port: 6454, universe: 0, respondToPoll: true, nodeName: 'Diamond LED Strobe' }
};

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}
function isObj(x) { return x && typeof x === 'object' && !Array.isArray(x); }
function merge(a, b) {
  const o = Object.assign({}, a);
  for (const k of Object.keys(b || {})) o[k] = isObj(b[k]) && isObj(o[k]) ? merge(o[k], b[k]) : b[k];
  return o;
}

let config = merge(DEFAULT_CONFIG, readJson(CONFIG_PATH, {}));
if (opt('port')) config.server.httpPort = parseInt(opt('port'), 10);
if (flag('lan')) config.server.httpHost = '0.0.0.0';
if (opt('host')) config.server.httpHost = opt('host');
if (!fs.existsSync(CONFIG_PATH)) saveConfig();

function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    const tmp = CONFIG_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
    fs.renameSync(tmp, CONFIG_PATH);
  } catch (e) { console.error('Could not save config:', e.message); }
}

const hasFfmpeg = (() => { try { return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0; } catch (e) { return false; } })();

// ---------- Art-Net ----------
const art = new ArtNetReceiver();
const dirty = new Map(); // universe -> Buffer
art.on('dmx', (universe, data) => { dirty.set(universe, data); });
art.on('status', () => pushStatus());

function artnetSettings() { return Object.assign({}, config.artnet); }
function startArtnet() {
  return art.start(artnetSettings()).then((ok) => {
    if (ok) console.log('[artnet] listening on ' + config.artnet.bindAddress + ':' + config.artnet.port + ' (universe ' + config.artnet.universe + ' used by the app)');
    else console.log('[artnet] ERROR: ' + art.status.error);
  });
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json', '.mp4': 'video/mp4', '.webm': 'video/webm', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska' };

function sendJson(res, code, obj) {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': b.length, 'Cache-Control': 'no-store' });
  res.end(b);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch (e) { return false; }
}
function statusObject() {
  const s = art.status;
  return {
    type: 'status', time: Date.now(), hasFfmpeg,
    artnet: { listening: s.listening, bindAddress: s.bindAddress, port: s.port, error: s.error, packetsPerSec: s.packetsPerSec, totalPackets: s.totalPackets, lastSource: s.lastSource, msSinceLastPacket: s.lastPacketAt ? Date.now() - s.lastPacketAt : null, universes: Object.keys(s.universes).map(Number), pollsAnswered: s.pollsAnswered },
    clients: ws ? ws.clients.size : 0,
    outputs: ws ? Array.from(ws.clients).filter((c) => c.role === 'output').length : 0
  };
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  try {
    if (p.startsWith('/api/')) {
      if (req.method !== 'GET' && !sameOrigin(req)) return sendJson(res, 403, { error: 'cross-origin request refused' });
      if (p === '/api/config' && req.method === 'GET') return sendJson(res, 200, config);
      if (p === '/api/config' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8') || '{}');
        const oldArt = JSON.stringify(config.artnet);
        const server_ = config.server; // server section is only editable in the file
        config = merge(config, body);
        config.server = server_;
        saveConfig();
        if (JSON.stringify(config.artnet) !== oldArt) await startArtnet();
        return sendJson(res, 200, { ok: true });
      }
      if (p === '/api/status') return sendJson(res, 200, statusObject());
      if (p === '/api/interfaces') return sendJson(res, 200, ipv4Interfaces());
      if (p === '/api/profiles') return sendJson(res, 200, readJson(PROFILES_PATH, []));
      if (p === '/api/convert-mp4' && req.method === 'POST') return convertMp4(req, res, u);
      if (p === '/api/media' && req.method === 'POST') return storeMedia(req, res, u);
      if (p.startsWith('/api/media/') && req.method === 'DELETE') { const id = path.basename(p); try { fs.unlinkSync(path.join(MEDIA, id)); } catch (e) { /* ignore */ } return sendJson(res, 200, { ok: true }); }
      return sendJson(res, 404, { error: 'unknown api' });
    }
    if (p.startsWith('/media/')) return serveMedia(req, res, p);
    // static
    let rel = decodeURIComponent(p);
    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(WEB, rel));
    if (!file.startsWith(WEB + path.sep) && file !== WEB) { res.writeHead(403); return res.end('forbidden'); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
  } catch (e) {
    sendJson(res, 400, { error: String(e.message || e) });
  }
});

// ---- uploaded video clips (so a separate output window/browser/PC can play the same clips) ----
const MEDIA = fs.mkdtempSync(path.join(os.tmpdir(), 'dls-media-'));
function cleanMedia() { try { fs.rmSync(MEDIA, { recursive: true, force: true }); } catch (e) { /* ignore */ } }
process.on('exit', cleanMedia);
function storeMedia(req, res, u) {
  const ext = (path.extname(u.searchParams.get('name') || '').replace(/[^.a-z0-9]/gi, '') || '.mp4').slice(0, 6);
  const id = crypto.randomBytes(8).toString('hex') + ext;
  const out = fs.createWriteStream(path.join(MEDIA, id));
  let n = 0, bad = false;
  req.on('data', (c) => { n += c.length; if (n > 4e9 && !bad) { bad = true; req.destroy(); } });
  req.pipe(out);
  out.on('finish', () => { if (bad) { try { fs.unlinkSync(path.join(MEDIA, id)); } catch (e) { /* ignore */ } return; } sendJson(res, 200, { url: '/media/' + id }); });
  out.on('error', () => sendJson(res, 500, { error: 'write failed' }));
}
function serveMedia(req, res, p) {
  const file = path.join(MEDIA, path.basename(p));
  fs.stat(file, (err, st) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    const type = MIME[path.extname(file)] || 'application/octet-stream';
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (m) {
      let a = m[1] === '' ? Math.max(0, st.size - parseInt(m[2], 10)) : parseInt(m[1], 10);
      let b = m[1] !== '' && m[2] !== '' ? parseInt(m[2], 10) : st.size - 1;
      b = Math.min(b, st.size - 1);
      if (a > b || a >= st.size) { res.writeHead(416, { 'Content-Range': 'bytes */' + st.size }); return res.end(); }
      res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': 'bytes ' + a + '-' + b + '/' + st.size, 'Content-Length': b - a + 1 });
      fs.createReadStream(file, { start: a, end: b }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': st.size });
      fs.createReadStream(file).pipe(res);
    }
  });
}

function convertMp4(req, res, u) {
  if (!hasFfmpeg) return sendJson(res, 501, { error: 'ffmpeg not found on PATH – install ffmpeg to enable MP4 conversion' });
  const ext = (u.searchParams.get('ext') || 'webm').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'webm';
  const fps = Math.max(1, Math.min(120, parseInt(u.searchParams.get('fps') || '30', 10) || 30));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dls-'));
  const inp = path.join(dir, 'in.' + ext), outp = path.join(dir, 'out.mp4');
  const ws_ = fs.createWriteStream(inp);
  let size = 0; let aborted = false;
  const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ } };
  req.on('data', (c) => { size += c.length; if (size > 2e9 && !aborted) { aborted = true; req.destroy(); } });
  req.pipe(ws_);
  ws_.on('finish', () => {
    if (aborted) { cleanup(); return; }
    const ff = spawn('ffmpeg', ['-y', '-i', inp, '-r', String(fps), '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outp], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    ff.on('close', (code) => {
      if (code !== 0 || !fs.existsSync(outp)) { cleanup(); return sendJson(res, 500, { error: 'ffmpeg failed', detail: err }); }
      const st = fs.statSync(outp);
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': st.size });
      fs.createReadStream(outp).pipe(res).on('close', cleanup);
    });
  });
}

// ---------- WebSocket ----------
const ws = new WSServer(server, {
  path: '/ws',
  originCheck: (origin, req) => { try { return new URL(origin).host === req.headers.host; } catch (e) { return false; } },
  onConnect: (c) => {
    c.sendText(JSON.stringify(statusObject()));
    // replay the latest frames so a freshly-opened page has data immediately
    for (const [u, d] of lastFrames) c.sendBinary(frame(u, d));
    c.onmessage = (m, isBin) => {
      if (isBin || typeof m !== 'string') return;
      if (m.charCodeAt(2) === 116 && m.startsWith('{"t":"f"')) { // live frame from the controller -> all other pages (output windows)
        for (const o of ws.clients) if (o !== c && o.role === 'output') o.sendText(m);
      } else if (m.startsWith('{"t":"hello"')) { try { c.role = JSON.parse(m).role || null; } catch (e) { /* ignore */ } pushStatus(); }
    };
    c.onclose = ((prev) => () => { prev && prev(); pushStatus(); })(c.onclose);
  }
});
const lastFrames = new Map();
function frame(universe, data) {
  const b = Buffer.alloc(3 + 512);
  b[0] = 1; b.writeUInt16LE(universe & 0xffff, 1); data.copy(b, 3, 0, 512);
  return b;
}
function pushStatus() { if (ws) ws.broadcastText(JSON.stringify(statusObject())); }

setInterval(() => { // coalesce to max ~125 frames/s per universe
  if (!dirty.size) return;
  for (const [u, d] of dirty) { lastFrames.set(u, d); ws.broadcastBinary(frame(u, d)); }
  dirty.clear();
}, 8);
setInterval(pushStatus, 1000);

// ---------- start ----------
function lanUrls(port) {
  return ipv4Interfaces().filter((i) => !i.internal).map((i) => 'http://' + i.address + ':' + port + '/');
}
server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? 'HTTP port ' + config.server.httpPort + ' is in use. Start with --port 8081' : e.message);
  process.exit(1);
});
server.listen(config.server.httpPort, config.server.httpHost, async () => {
  const port = config.server.httpPort;
  console.log('\n  ◆ Diamond LED Strobe Player – bridge running');
  console.log('  Web app:  http://localhost:' + port + '/');
  if (config.server.httpHost !== '127.0.0.1' && config.server.httpHost !== 'localhost') lanUrls(port).forEach((u) => console.log('  LAN:      ' + u));
  else console.log('  (HTTP is bound to this computer only. Use --lan to open it to tablets/phones on the network.)');
  console.log('  ffmpeg:   ' + (hasFfmpeg ? 'found (MP4 conversion enabled)' : 'not found (WebM/MP4 recording still works in-browser)'));
  await startArtnet();
  console.log('  Press Ctrl+C to quit.\n');
  if (flag('open')) {
    const url = 'http://localhost:' + port + '/';
    const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch (e) { /* ignore */ }
  }
});
process.on('SIGINT', () => { art.stop(); process.exit(0); });
process.on('SIGTERM', () => { art.stop(); process.exit(0); });

module.exports = { server, art };
