'use strict';
// Art-Net 4 receiver (ArtDmx in, ArtPollReply out). Pure Node, no dependencies.
const dgram = require('dgram');
const os = require('os');
const { EventEmitter } = require('events');

const ID = Buffer.from('Art-Net\0', 'ascii');
const OP_POLL = 0x2000;
const OP_DMX = 0x5000;

function ipv4Interfaces() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const a of ifs[name] || []) {
      if (a.family === 'IPv4' || a.family === 4) out.push({ name, address: a.address, netmask: a.netmask, mac: a.mac, internal: a.internal });
    }
  }
  return out;
}
function ipToInt(ip) { return ip.split('.').reduce((a, b) => ((a << 8) | (parseInt(b, 10) & 255)) >>> 0, 0) >>> 0; }
function sameSubnet(a, b, mask) { return ((ipToInt(a) & ipToInt(mask)) >>> 0) === ((ipToInt(b) & ipToInt(mask)) >>> 0); }

class ArtNetReceiver extends EventEmitter {
  constructor() {
    super();
    this.sock = null;
    this.cfg = null;
    this.status = this._blank();
    this._pps = 0;
    this._ppsTimer = null;
  }
  _blank() {
    return { listening: false, bindAddress: null, port: null, error: null, packetsPerSec: 0, totalPackets: 0, lastSource: null, lastPacketAt: 0, universes: {}, pollsAnswered: 0 };
  }
  start(cfg) {
    this.stop();
    this.cfg = Object.assign({ bindAddress: '0.0.0.0', port: 6454, respondToPoll: true, nodeName: 'Diamond LED Strobe', universe: 0 }, cfg);
    this.status = this._blank();
    return new Promise((resolve) => {
      const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.sock = s;
      s.on('error', (e) => {
        this.status.listening = false;
        this.status.error = e.code === 'EADDRINUSE'
          ? 'UDP port ' + this.cfg.port + ' is already in use (another Art-Net program running?)'
          : e.code === 'EADDRNOTAVAIL' ? 'Bind address ' + this.cfg.bindAddress + ' is not an address of this computer' : String(e.message || e);
        try { s.close(); } catch (x) { /* ignore */ }
        this.sock = null;
        this.emit('status');
        resolve(false);
      });
      s.on('message', (msg, rinfo) => this._packet(msg, rinfo));
      s.on('listening', () => {
        try { s.setBroadcast(true); } catch (e) { /* ignore */ }
        this.status.listening = true;
        this.status.bindAddress = this.cfg.bindAddress;
        this.status.port = this.cfg.port;
        this.emit('status');
        resolve(true);
      });
      s.bind(this.cfg.port, this.cfg.bindAddress);
      this._ppsTimer = setInterval(() => { this.status.packetsPerSec = this._pps; this._pps = 0; }, 1000);
    });
  }
  stop() {
    if (this._ppsTimer) { clearInterval(this._ppsTimer); this._ppsTimer = null; }
    if (this.sock) { try { this.sock.close(); } catch (e) { /* ignore */ } this.sock = null; }
    this.status.listening = false;
  }
  _packet(msg, rinfo) {
    if (msg.length < 12 || !msg.subarray(0, 8).equals(ID)) return;
    const op = msg.readUInt16LE(8);
    if (op === OP_DMX) {
      if (msg.length < 18) return;
      const subUni = msg[14];
      const net = msg[15] & 0x7f;
      const universe = (net << 8) | subUni;
      let len = msg.readUInt16BE(16);
      len = Math.min(len, 512, msg.length - 18);
      if (len < 1) return;
      const data = Buffer.alloc(512);
      msg.copy(data, 0, 18, 18 + len);
      this._pps++;
      const st = this.status;
      st.totalPackets++;
      st.lastSource = rinfo.address;
      st.lastPacketAt = Date.now();
      st.universes[universe] = st.lastPacketAt;
      this.emit('dmx', universe, data, rinfo);
    } else if (op === OP_POLL) {
      if (this.cfg.respondToPoll && this.sock) this._pollReply(rinfo);
    }
  }
  _pollReply(rinfo) {
    const ifs = ipv4Interfaces().filter((i) => !i.internal);
    let local = this.cfg.bindAddress && this.cfg.bindAddress !== '0.0.0.0' ? ifs.find((i) => i.address === this.cfg.bindAddress) : null;
    if (!local) local = ifs.find((i) => sameSubnet(i.address, rinfo.address, i.netmask)) || ifs[0];
    const ip = local ? local.address : '0.0.0.0';
    const mac = local && local.mac ? local.mac.split(':').map((h) => parseInt(h, 16)) : [0, 0, 0, 0, 0, 0];
    const u = (this.cfg.universe | 0) & 0x7fff;
    const b = Buffer.alloc(239);
    ID.copy(b, 0);
    b.writeUInt16LE(0x2100, 8);
    ip.split('.').forEach((p, i) => { b[10 + i] = parseInt(p, 10) & 255; });
    b.writeUInt16LE(0x1936, 14);
    b.writeUInt16BE(14, 16);
    b[18] = (u >> 8) & 0x7f; b[19] = (u >> 4) & 0x0f;
    b.writeUInt16BE(0x7ff0, 20); // OEM: unassigned/experimental
    b[23] = 0xd0; // status1: indicators normal, port-address programmed by network
    b.write(String(this.cfg.nodeName).slice(0, 17), 26, 'ascii');
    b.write('Diamond LED Strobe Player (Art-Net bridge)', 44, 'ascii');
    b.write('#0001 [0000] Receiving DMX', 108, 'ascii');
    b.writeUInt16BE(1, 172);
    b[174] = 0x80; // port 1: DMX512 output (we receive Art-Net => output side of a node)
    b[182] = 0x80; // good output: data being transmitted
    b[190] = u & 0x0f; // SwOut[0]
    b[200] = 0x00; // StNode
    mac.forEach((m, i) => { b[201 + i] = m & 255; });
    ip.split('.').forEach((p, i) => { b[207 + i] = parseInt(p, 10) & 255; });
    b[211] = 1;
    b[212] = 0x08; // status2: port-address 15-bit capable
    this.sock.send(b, 6454, rinfo.address, () => { this.status.pollsAnswered++; });
  }
}

module.exports = { ArtNetReceiver, ipv4Interfaces, OP_DMX, OP_POLL };
