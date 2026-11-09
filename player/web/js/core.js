/* Core: namespace, event bus, config store, layout */
(function (g) {
  'use strict';
  const DLS = g.DLS = g.DLS || {};

  // ---------- event bus ----------
  const handlers = {};
  DLS.bus = {
    on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
    emit(ev, a, b) { (handlers[ev] || []).forEach((fn) => { try { fn(a, b); } catch (e) { console.error(ev, e); } }); }
  };

  // ---------- layout (physical wall) ----------
  // Panel i (0-based) owns output pixels [i*500, i*500+499] on the 4000x500 canvas.
  // x/y are cabinet CENTRES in units of one cabinet DIAGONAL (y grows downward).
  // Rows are interlocked diamonds: P1/P2 sit wider apart and slightly higher than P3/P4 (positions measured from the reference screenshot), row 3 (3 panels) nests below, panel 8 hangs below.
  DLS.layout = {
    PANEL: 500, COUNT: 8, OUT_W: 4000, OUT_H: 500,
    panels: [
      { id: 1, x: -0.715, y: 0.217, group: 0 }, { id: 2, x: 0.715, y: 0.217, group: 0 },
      { id: 3, x: -0.5, y: 1.0, group: 1 }, { id: 4, x: 0.5, y: 1.0, group: 1 },
      { id: 5, x: -1.0, y: 1.5, group: 2 }, { id: 6, x: 0.0, y: 1.5, group: 2 }, { id: 7, x: 1.0, y: 1.5, group: 2 },
      { id: 8, x: 0.0, y: 2.5, group: 3 }
    ],
    groups: [
      { name: 'Top', key: 'Z', panels: [0, 1] },
      { name: 'Mid-upper', key: 'X', panels: [2, 3] },
      { name: 'Mid-lower', key: 'C', panels: [4, 5, 6] },
      { name: 'Bottom', key: 'V', panels: [7] }
    ],
    bounds() {
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      this.panels.forEach((p) => { x0 = Math.min(x0, p.x - 0.5); x1 = Math.max(x1, p.x + 0.5); y0 = Math.min(y0, p.y - 0.5); y1 = Math.max(y1, p.y + 0.5); });
      return { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0 };
    },
    // optional override from config.layout.positions = [[x,y] x8]
    applyOverride(pos) {
      if (!Array.isArray(pos) || pos.length !== 8) return;
      pos.forEach((p, i) => { if (Array.isArray(p) && isFinite(p[0]) && isFinite(p[1])) { this.panels[i].x = +p[0]; this.panels[i].y = +p[1]; } });
    }
  };

  // ---------- config ----------
  const DEFAULTS = {
    version: 5,
    mode: 'manual',
    artnet: { bindAddress: '0.0.0.0', port: 6454, universe: 0, respondToPoll: true, nodeName: 'Diamond LED Strobe' },
    fixture: {
      profile: 'dimmer-rgb', customChannels: 'dim,r,g,b', startAddress: 1, count: 1, spacing: 0,
      mix: 'max', whiteMode: 'add', dimmerScalesColor: true, gainR: 100, gainG: 100, gainB: 100, gamma: 1.0
    },
    tiger: {
      colorMode: 'fixture', flashSource: 'intensity', flashChannel: 20, strobeMin: 10, intensityThreshold: 40,
      gate: true, colorChangeDelta: 60, patternAdvance: 'channelEdge', patternChannel: 21, flashesPerPattern: 0,
      masterChannel: 0, signalTimeoutMs: 2000, videoChannel: 22, flashesPerVideo: 0
    },
    audio: {
      source: 'mic', deviceId: '', sensitivity: 55, division: '1', beatsPerPattern: 16, colorMode: 'bands',
      minGapMs: 280, monitor: true, beatsPerVideo: 1
    },
    manual: { colour: [255, 255, 255], hardWhite: false },
    output: { fit: 'stretch', brightness: 100, flashMs: 120, decay: 0, speedHz: 3, showLabels: false, showWiringPath: true, fps: 30 },
    safety: { safe: true, maxHz: 3, maxBrightness: 70, fadeInMs: 800, ack: false },
    video: { enabled: true, level: 100, blend: 'normal', overlayStrength: 85, xfadeMs: 0, warm: true, mapMode: 'auto', order: 'random', specialMinMin: 4, specialMaxMin: 5 },
    neon: { on: true, style: 'electric', auto: true, autoBeats: 4, autoSec: 10, autoOrder: 'random', off: [], order: 'wiring', custom: '1,2,3,4,5,6,7,8', palette: 'auto', speed: 1, width: 12, glow: 70, brightness: 100, blend: 'screen', ultra: true, dim: 40 },
    colours: { off: [] },
    layout: { positions: null }
  };
  function isObj(x) { return x && typeof x === 'object' && !Array.isArray(x); }
  function merge(a, b) {
    const o = Array.isArray(a) ? a.slice() : Object.assign({}, a);
    Object.keys(b || {}).forEach((k) => { o[k] = isObj(b[k]) && isObj(o[k]) ? merge(o[k], b[k]) : b[k]; });
    return o;
  }
  let cfg = JSON.parse(JSON.stringify(DEFAULTS));
  let serverMode = false;
  let saveTimer = null;
  const LS_KEY = 'dls-config-v1';

  DLS.config = {
    DEFAULTS,
    get() { return cfg; },
    isServerMode() { return serverMode; },
    getPath(path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), cfg); },
    setPath(path, val, silent) {
      const ks = path.split('.'); let o = cfg;
      for (let i = 0; i < ks.length - 1; i++) { if (!isObj(o[ks[i]])) o[ks[i]] = {}; o = o[ks[i]]; }
      o[ks[ks.length - 1]] = val;
      if (!silent) { DLS.bus.emit('config', path); this.save(); }
    },
    load() {
      let local = null;
      try { local = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { /* ignore */ }
      const canFetch = /^https?:$/.test(location.protocol);
      const done = (remote) => {
        cfg = merge(DEFAULTS, merge(local || {}, remote || {}));
        if (!(cfg.version >= 2)) { // v2: video cuts follow every beat, randomly and instantly (older saved settings said every 8 beats + 300 ms fade)
          cfg.version = 2; cfg.audio.beatsPerVideo = 1; cfg.video.xfadeMs = 0; cfg.video.order = 'random'; cfg.video.warm = true;
          setTimeout(() => { try { DLS.config.save(); } catch (e) { /* ignore */ } }, 0);
        }
        if (!(cfg.version >= 3)) { // v3: 4000x500 clips used to be squeezed through the diamond-wall mapping (only ~11% of the clip visible) -> new 'auto' mode
          cfg.version = 3; if (cfg.video.mapMode === 'wall') cfg.video.mapMode = 'auto';
          setTimeout(() => { try { DLS.config.save(); } catch (e) { /* ignore */ } }, 0);
        }
        if (!(cfg.version >= 4)) { // v4: 20 neon styles; old 16px 'neon' palette setting -> style's own colours, thinner line for sharper quality
          cfg.version = 4; if (cfg.neon) { cfg.neon.palette = 'auto'; if (cfg.neon.width === 16) cfg.neon.width = 12; if (!cfg.neon.style) cfg.neon.style = 'electric'; }
          setTimeout(() => { try { DLS.config.save(); } catch (e) { /* ignore */ } }, 0);
        }
        if (!(cfg.version >= 5)) { // v5: neon auto-switch on by default, every 4 beats, works in every control mode
          cfg.version = 5; if (cfg.neon) { cfg.neon.auto = true; if (!(cfg.neon.autoBeats < 8)) cfg.neon.autoBeats = 4; }
          setTimeout(() => { try { DLS.config.save(); } catch (e) { /* ignore */ } }, 0);
        }
        if (cfg.layout && cfg.layout.positions) DLS.layout.applyOverride(cfg.layout.positions);
        return cfg;
      };
      if (!canFetch) return Promise.resolve(done(null));
      return fetch('/api/config', { cache: 'no-store' }).then((r) => r.json()).then((remote) => { serverMode = true; return done(remote); }).catch(() => done(null));
    },
    save() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ }
        if (serverMode) {
          fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) }).catch(() => {});
        }
      }, 400);
    }
  };

  // ---------- helpers ----------
  DLS.util = {
    clamp(v, a, b) { return v < a ? a : v > b ? b : v; },
    hslToRgb(h, s, l) {
      h = ((h % 360) + 360) % 360 / 360;
      const f = (n) => { const k = (n + h * 12) % 12; const a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
      return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
    }
  };
  // Fully saturated strobe palette (every colour has at least one channel at 255 and the rest at 0 or fully mixed)
  DLS.COLOURS = [
    { name: 'Red', rgb: [255, 0, 0] }, { name: 'Orange', rgb: [255, 90, 0] }, { name: 'Yellow', rgb: [255, 255, 0] },
    { name: 'Lime', rgb: [120, 255, 0] }, { name: 'Green', rgb: [0, 255, 0] }, { name: 'Cyan', rgb: [0, 255, 255] },
    { name: 'Sky Blue', rgb: [0, 130, 255] }, { name: 'Blue', rgb: [0, 0, 255] },
    { name: 'Purple', rgb: [150, 0, 255] }, { name: 'Magenta', rgb: [255, 0, 255] }, { name: 'Pink', rgb: [255, 0, 110] },
    { name: 'White', rgb: [255, 255, 255] }
  ];

  // Colour on/off list: only ENABLED colours are used by the music (Audio) mode and by the K key in Manual mode.
  DLS.palette = {
    isOn(name) { const o = DLS.config.get().colours.off; return o.indexOf(name) < 0; },
    enabled() {
      const l = DLS.COLOURS.filter((c) => DLS.palette.isOn(c.name));
      return l.length ? l : [DLS.COLOURS[DLS.COLOURS.length - 1]]; // never empty: fall back to White
    },
    set(name, on) {
      const c = DLS.config.get().colours; const i = c.off.indexOf(name);
      if (on && i >= 0) c.off.splice(i, 1);
      if (!on && i < 0) {
        if (DLS.COLOURS.filter((x) => c.off.indexOf(x.name) < 0).length <= 1) return false; // keep at least one on
        c.off.push(name);
      }
      DLS.config.save(); DLS.bus.emit('colours'); return true;
    },
    setAll(on) { DLS.config.get().colours.off = on ? [] : DLS.COLOURS.slice(0, -1).map((c) => c.name); DLS.config.save(); DLS.bus.emit('colours'); },
    // closest enabled colour to any rgb (after normalising the strongest channel to 255)
    nearest(rgb) {
      const m = Math.max(rgb[0], rgb[1], rgb[2], 1);
      const n = [rgb[0] * 255 / m, rgb[1] * 255 / m, rgb[2] * 255 / m];
      let best = null, bd = 1e12;
      DLS.palette.enabled().forEach((c) => { const d = (c.rgb[0] - n[0]) ** 2 + (c.rgb[1] - n[1]) ** 2 + (c.rgb[2] - n[2]) ** 2; if (d < bd) { bd = d; best = c; } });
      return best;
    }
  };
  // push any colour to full intensity and full saturation (white stays white)
  DLS.util.vivid = function (rgb) {
    const m = Math.max(rgb[0], rgb[1], rgb[2]); if (m < 8) return rgb;
    let n = rgb.map((v) => v * 255 / m); const mn = Math.min(n[0], n[1], n[2]);
    n = n.map((v) => v - mn * 0.85); const m2 = Math.max(n[0], n[1], n[2]);
    return n.map((v) => Math.round(v * 255 / m2));
  };
})(window);
