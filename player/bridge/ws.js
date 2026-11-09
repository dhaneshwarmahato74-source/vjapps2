'use strict';
// Minimal dependency-free WebSocket server (RFC 6455) – enough for this app.
const crypto = require('crypto');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 1024 * 1024;

class WSClient {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.fragments = [];
    this.fragOp = 0;
    this.alive = true;
    this.onmessage = null;
    this.onclose = null;
    socket.on('data', (d) => this._data(d));
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
  }
  _closed() {
    if (!this.alive) return;
    this.alive = false;
    if (this.onclose) this.onclose();
  }
  _data(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const op = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (len > MAX_PAYLOAD) { this.close(); return; }
      const need = off + (masked ? 4 : 0) + len;
      if (b.length < need) return;
      let payload = b.subarray(off + (masked ? 4 : 0), need);
      if (masked) {
        const m = b.subarray(off, off + 4);
        const out = Buffer.allocUnsafe(len);
        for (let i = 0; i < len; i++) out[i] = payload[i] ^ m[i & 3];
        payload = out;
      }
      this.buf = b.subarray(need);
      this._frame(fin, op, payload);
    }
  }
  _frame(fin, op, payload) {
    if (op === 8) { this.close(); return; }
    if (op === 9) { this._send(10, payload); return; }
    if (op === 10) return;
    if (op === 0) {
      this.fragments.push(payload);
      if (fin) { const full = Buffer.concat(this.fragments); this.fragments = []; this._deliver(this.fragOp, full); }
      return;
    }
    if (!fin) { this.fragOp = op; this.fragments = [payload]; return; }
    this._deliver(op, payload);
  }
  _deliver(op, payload) {
    if (this.onmessage) this.onmessage(op === 1 ? payload.toString('utf8') : payload, op === 2);
  }
  _send(op, payload) {
    if (!this.alive) return false;
    const len = payload.length;
    let hdr;
    if (len < 126) hdr = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { hdr = Buffer.alloc(4); hdr[0] = 0x80 | op; hdr[1] = 126; hdr.writeUInt16BE(len, 2); }
    else { hdr = Buffer.alloc(10); hdr[0] = 0x80 | op; hdr[1] = 127; hdr.writeBigUInt64BE(BigInt(len), 2); }
    try { this.socket.write(Buffer.concat([hdr, payload])); return true; } catch (e) { this._closed(); return false; }
  }
  sendText(s) { return this._send(1, Buffer.from(s, 'utf8')); }
  sendBinary(buf, dropIfBusy) {
    if (dropIfBusy && this.socket.writableLength > 256 * 1024) return false; // slow client: drop frame
    return this._send(2, buf);
  }
  close() {
    if (!this.alive) return;
    try { this._send(8, Buffer.alloc(0)); this.socket.end(); } catch (e) { /* ignore */ }
    this._closed();
  }
}

class WSServer {
  constructor(httpServer, opts) {
    this.clients = new Set();
    this.opts = opts || {};
    const path = this.opts.path || '/ws';
    httpServer.on('upgrade', (req, socket) => {
      const url = req.url || '';
      if (!url.startsWith(path) || !/websocket/i.test(req.headers.upgrade || '')) { socket.destroy(); return; }
      const origin = req.headers.origin;
      if (origin && this.opts.originCheck && !this.opts.originCheck(origin, req)) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      const key = req.headers['sec-websocket-key'];
      if (!key) { socket.destroy(); return; }
      const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
      socket.setNoDelay(true);
      const c = new WSClient(socket);
      this.clients.add(c);
      c.onclose = () => this.clients.delete(c);
      if (this.opts.onConnect) this.opts.onConnect(c);
    });
  }
  broadcastText(s) { for (const c of this.clients) c.sendText(s); }
  broadcastBinary(b) { for (const c of this.clients) c.sendBinary(b, true); }
}

module.exports = { WSServer, WSClient };
