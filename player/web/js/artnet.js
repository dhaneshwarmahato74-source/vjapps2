/* Art-Net / Tiger Touch II mode: WebSocket client of the local bridge + fixture mapping + trigger logic */
(function () {
  'use strict';
  const D = window.DLS;
  const cfg = () => D.config.get();

  const BUILTIN_PROFILES = [
    { id: 'rgb', name: 'RGB (3ch)', channels: ['r', 'g', 'b'] },
    { id: 'dimmer-rgb', name: 'Dimmer + RGB (4ch)', channels: ['dim', 'r', 'g', 'b'] }
  ];

  const A = D.artnet = {
    profiles: BUILTIN_PROFILES,
    ws: null, connected: false, bridge: null, lastStatusAt: 0,
    dmx: {}, // universe -> Uint8Array(512)
    fps: 0, _fc: 0, lastFrameAt: 0, lastTriggerAt: 0, triggers: 0,
    fixture: { r: 0, g: 0, b: 0, w: 0, dim: 0, level: 0, list: [] },
    wallColour: [255, 255, 255],
    on: false, prevCol: [0, 0, 0], chanOn: false, patChanOn: false, lastPatSel: -1, stale: true,

    loadProfiles() {
      if (!D.config.isServerMode()) return Promise.resolve();
      return fetch('/api/profiles').then((r) => r.json()).then((p) => { if (Array.isArray(p) && p.length) A.profiles = p; }).catch(() => {});
    },
    footprintRoles() {
      const f = cfg().fixture;
      if (f.profile === 'custom') return f.customChannels.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      const p = A.profiles.find((x) => x.id === f.profile) || A.profiles[1] || A.profiles[0];
      return p.channels;
    },
    connect() {
      if (!/^https?:$/.test(location.protocol)) { D.bus.emit('artnet-status'); return; }
      const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
      let ws;
      try { ws = new WebSocket(url); } catch (e) { setTimeout(() => A.connect(), 2000); return; }
      ws.binaryType = 'arraybuffer';
      A.ws = ws;
      ws.onopen = () => { A.connected = true; D.bus.emit('artnet-status'); };
      ws.onclose = () => { A.connected = false; A.bridge = null; A.stale = true; D.engine.release('tiger'); D.bus.emit('artnet-status'); setTimeout(() => A.connect(), 1500); };
      ws.onerror = () => { try { ws.close(); } catch (e) { /* ignore */ } };
      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          try { const m = JSON.parse(ev.data); if (m.type === 'status') { A.bridge = m; A.lastStatusAt = performance.now(); D.bus.emit('artnet-status'); } } catch (e) { /* ignore */ }
          return;
        }
        const b = new Uint8Array(ev.data);
        if (b[0] !== 1 || b.length < 515) return;
        const universe = b[1] | (b[2] << 8);
        const data = A.dmx[universe] || (A.dmx[universe] = new Uint8Array(512));
        data.set(b.subarray(3, 515));
        A._fc++; A.lastFrameAt = performance.now();
        if (universe === (cfg().artnet.universe | 0)) A.process(data);
        D.bus.emit('dmx', universe);
      };
    },

    /* ---- fixture mapping ---- */
    readFixtures(data) {
      const f = cfg().fixture;
      const roles = A.footprintRoles();
      const fp = roles.length || 1;
      const step = f.spacing > 0 ? f.spacing : fp;
      const list = [];
      for (let n = 0; n < Math.max(1, f.count); n++) {
        const base = (f.startAddress - 1) + n * step;
        if (base < 0 || base + fp > 512) break;
        const v = { r: 0, g: 0, b: 0, w: 0, dim: 255, hasDim: false };
        roles.forEach((role, i) => {
          const val = data[base + i];
          if (role === 'r' || role === 'g' || role === 'b' || role === 'w') v[role] = val;
          else if (role === 'dim') { v.dim = val; v.hasDim = true; }
        });
        list.push(v);
      }
      return list;
    },
    mixFixture(list) {
      const f = cfg().fixture;
      const gain = [f.gainR / 100, f.gainG / 100, f.gainB / 100];
      const prep = list.map((v) => {
        let r = v.r, g = v.g, b = v.b;
        if (f.whiteMode === 'add') { r += v.w; g += v.w; b += v.w; }
        r = Math.min(255, r * gain[0]); g = Math.min(255, g * gain[1]); b = Math.min(255, b * gain[2]);
        if (f.gamma !== 1) { r = 255 * Math.pow(r / 255, f.gamma); g = 255 * Math.pow(g / 255, f.gamma); b = 255 * Math.pow(b / 255, f.gamma); }
        const dim = v.dim / 255;
        return { r, g, b, w: v.w, dim, level: Math.max(r, g, b) / 255 * dim };
      });
      if (!prep.length) return { r: 0, g: 0, b: 0, w: 0, dim: 0, level: 0, list: [] };
      let out;
      if (f.mix === 'first') out = prep[0];
      else if (f.mix === 'avgLit') {
        const lit = prep.filter((p) => p.level > 0.02);
        const use = lit.length ? lit : prep;
        const s = use.reduce((a, p) => ({ r: a.r + p.r, g: a.g + p.g, b: a.b + p.b, w: a.w + p.w, dim: a.dim + p.dim }), { r: 0, g: 0, b: 0, w: 0, dim: 0 });
        const n = use.length;
        out = { r: s.r / n, g: s.g / n, b: s.b / n, w: s.w / n, dim: s.dim / n };
        out.level = Math.max(out.r, out.g, out.b) / 255 * out.dim;
      } else { // max
        out = prep.reduce((a, p) => ({ r: Math.max(a.r, p.r), g: Math.max(a.g, p.g), b: Math.max(a.b, p.b), w: Math.max(a.w, p.w), dim: Math.max(a.dim, p.dim), level: Math.max(a.level, p.level) }));
      }
      return Object.assign({}, out, { list: prep });
    },

    /* ---- trigger logic (called for every frame of the selected universe) ---- */
    process(data) {
      const T = cfg().tiger, E = D.engine, S = D.state;
      A.stale = false;
      const list = A.readFixtures(data);
      const fx = A.fixture = A.mixFixture(list);
      // monitoring always updates (diagnostics) – but the engine ignores everything unless mode === 'tiger'
      if (S.mode !== 'tiger') { A.on = false; A.chanOn = false; A.strobeVal = 0; return; }

      // master brightness channel
      E.setMaster('tiger', T.masterChannel > 0 ? data[T.masterChannel - 1] / 255 : 1);

      // wall colour
      let col;
      if (T.colorMode === 'white') col = [255, 255, 255];
      else {
        const k = cfg().fixture.dimmerScalesColor ? fx.dim : 1;
        col = D.util.vivid([fx.r * k, fx.g * k, fx.b * k]); // always full-intensity, saturated
      }
      if (fx.level > 0.02 || T.colorMode === 'white') { A.wallColour = col; E.setColour('tiger', col); }

      const thr = T.intensityThreshold / 100;
      let rising = false, falling = false;
      if (T.flashSource === 'intensity') {
        if (!A.on && fx.level >= thr) { A.on = true; rising = true; }
        else if (A.on && fx.level < thr * 0.6) { A.on = false; falling = true; }
      } else if (T.flashSource === 'channel') {
        const v = data[T.flashChannel - 1] || 0;
        if (!A.chanOn && v >= 128) { A.chanOn = true; rising = true; }
        else if (A.chanOn && v < 100) { A.chanOn = false; falling = true; }
      } else if (T.flashSource === 'strobech') { // console strobe attribute: value >= strobeMin = strobing, rate follows the value (see strobeTick)
        const v = data[T.flashChannel - 1] || 0;
        A.strobeVal = v >= (T.strobeMin || 10) ? v : 0;
      } else if (T.flashSource === 'color') {
        const d = Math.abs(fx.r - A.prevCol[0]) + Math.abs(fx.g - A.prevCol[1]) + Math.abs(fx.b - A.prevCol[2]);
        if (fx.level >= thr && d >= T.colorChangeDelta) rising = true;
        A.prevCol = [fx.r, fx.g, fx.b];
      }
      const gate = T.gate && T.flashSource !== 'color' && T.flashSource !== 'strobech';
      if (rising) A._flash(gate);
      if (falling && gate) E.release('tiger');

      // video change pulse from the console
      if (T.videoChannel > 0) {
        const vv = data[T.videoChannel - 1] || 0;
        if (!A.vidChanOn && vv >= 128) { A.vidChanOn = true; D.video.change('tiger'); }
        else if (A.vidChanOn && vv < 100) A.vidChanOn = false;
      }

      // pattern control from the console
      if (T.patternAdvance !== 'none' && T.patternChannel > 0) {
        const v = data[T.patternChannel - 1] || 0;
        if (T.patternAdvance === 'channelEdge') {
          if (!A.patChanOn && v >= 128) { A.patChanOn = true; E.advancePattern('tiger', 1); }
          else if (A.patChanOn && v < 100) A.patChanOn = false;
        } else if (T.patternAdvance === 'channelSelect') {
          const n = D.patterns.list.length;
          const idx = Math.min(n - 1, Math.floor(v / (256 / n)));
          if (idx !== A.lastPatSel) { A.lastPatSel = idx; E.selectPattern('tiger', idx); }
        }
      }
    },

    _flash(gate) {
      const T = cfg().tiger, E = D.engine, S = D.state;
      if (E.trigger('tiger', { gate })) {
        A.lastTriggerAt = performance.now(); A.triggers++;
        if (T.flashesPerPattern > 0 && S.flashCount % T.flashesPerPattern === 0) E.advancePattern('tiger', 1);
        if (T.flashesPerVideo > 0 && S.flashCount % T.flashesPerVideo === 0) D.video.change('tiger');
        return true;
      }
      return false;
    },
    // console strobe channel -> repeated wall flashes (called every tick; rate = 1..12 Hz from the channel value, then safety-limited)
    strobeTick(t) {
      if (!A.strobeVal || D.state.mode !== 'tiger' || A.stale) { A.nextStrobe = 0; return; }
      if (t < (A.nextStrobe || 0)) return;
      const min = cfg().tiger.strobeMin || 10;
      const hz = 1 + D.util.clamp((A.strobeVal - min) / Math.max(1, 255 - min), 0, 1) * 11;
      A.nextStrobe = t + 1000 / hz;
      A._flash(false);
    },

    // signal-loss watchdog: called from the main tick
    watchdog(t) {
      const S = D.state;
      const timeout = cfg().tiger.signalTimeoutMs;
      const lost = !A.lastFrameAt || (t - A.lastFrameAt) > timeout;
      if (lost && !A.stale) {
        A.stale = true; A.on = false; A.chanOn = false; A.strobeVal = 0;
        if (S.mode === 'tiger') D.engine.release('tiger');
      }
      if (t - (A._fpsT || 0) >= 1000) { A.fps = A._fc; A._fc = 0; A._fpsT = t; }
    },
    signalState() {
      if (!A.connected) return 'nobridge';
      if (A.bridge && A.bridge.artnet && !A.bridge.artnet.listening) return 'error';
      if (A.stale) return 'nosignal';
      return 'ok';
    }
  };
})();
