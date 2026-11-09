/* Engine: pattern state, flash envelopes, safety limiter, control-source gating.
   Only the active control source (tiger | audio | manual) can drive the wall.
   Events from other sources are counted as "ignored" and dropped. */
(function () {
  'use strict';
  const D = window.DLS;
  const N = 8;
  const S = D.state = {
    mode: 'manual',
    patternIdx: 0, step: -1,
    panels: Array.from({ length: N }, () => ({ t0: -1e12, gate: false })),
    manualHold: new Set(),
    strobeHeld: false, nextStrobe: 0,
    blackout: false, fadeStart: -1e12,
    colour: { manual: [255, 255, 255], tiger: [255, 255, 255], audio: [255, 255, 255] },
    master: { tiger: 1 },
    lastFire: -1e12, flashCount: 0, limited: 0, limitedAt: -1e12,
    ignored: { tiger: 0, audio: 0, manual: 0 },
    lastSet: [], lastFlashAt: -1e12,
    test: { panels: new Set(), all: false },
    out: Array.from({ length: N }, () => [0, 0, 0]),
    levels: new Array(N).fill(0),
    cols: Array.from({ length: N }, () => [0, 0, 0]), alpha: new Array(N).fill(0), fade: 1,
    brightEff: 0
  };
  const cfg = () => D.config.get();
  const now = () => performance.now();

  function effMaxHz() { const s = cfg().safety; return s.safe ? Math.min(3, s.maxHz) : Math.min(12, s.maxHz); }
  function effMaxBright() { const s = cfg().safety; return s.safe ? Math.min(70, s.maxBrightness) : s.maxBrightness; }
  function holdMs() { const o = cfg().output; return Math.max(5, o.flashMs * (1 - o.decay / 100)); }
  function rampMs() { const o = cfg().output; return o.flashMs * (o.decay / 100); }

  function level(st, t) {
    if (st.gate) return 1;
    const age = t - st.t0, h = holdMs(), r = rampMs();
    if (age < 0) return 0;
    if (age < h) return 1;
    if (r > 0 && age < h + r) return 1 - (age - h) / r;
    return 0;
  }

  const E = D.engine = {
    effMaxHz, effMaxBright,

    /* ---- internal flash ---- */
    _fire(opts, t) {
      t = t || now();
      if (t - S.lastFire < 1000 / effMaxHz()) { S.limited++; S.limitedAt = t; return false; }
      S.lastFire = t;
      S.step++;
      const p = D.patterns.list[S.patternIdx];
      const set = p.at(S.step);
      for (const i of set) { S.panels[i].t0 = t; S.panels[i].gate = !!(opts && opts.gate); }
      S.lastSet = set; S.flashCount++; S.lastFlashAt = t;
      D.bus.emit('flash', set);
      return true;
    },

    /* ---- source-gated inputs ---- */
    accept(src) { if (src !== S.mode) { S.ignored[src] = (S.ignored[src] || 0) + 1; return false; } return true; },
    trigger(src, opts) { return this.accept(src) ? this._fire(opts) : false; },
    release(src) {
      if (src !== S.mode) return;
      const t = now();
      for (const st of S.panels) if (st.gate) { st.gate = false; st.t0 = t - holdMs(); }
    },
    setColour(src, rgb) { if (this.accept(src)) S.colour[src] = rgb; },
    setMaster(src, v) { if (src === S.mode) S.master[src] = v; },
    advancePattern(src, dir) { if (!this.accept(src)) return false; this._setPattern(S.patternIdx + (dir || 1)); return true; },
    selectPattern(src, i) { if (!this.accept(src)) return false; this._setPattern(i); return true; },
    _setPattern(i) {
      const n = D.patterns.list.length;
      i = ((i % n) + n) % n;
      if (i === S.patternIdx) return;
      S.patternIdx = i; S.step = -1;
      D.bus.emit('pattern', i);
    },
    // UI click on a pattern = choose the pattern (start point / lock); allowed in any mode, not a flash source
    uiSelectPattern(i) { this._setPattern(i); D.bus.emit('pattern', S.patternIdx); },

    /* ---- manual holds (manual mode only) ---- */
    holdPanels(src, list, on) {
      if (!this.accept(src)) return;
      if (on) {
        const t = now();
        if (t - S.lastFire < 1000 / effMaxHz()) { S.limited++; S.limitedAt = t; return; }
        S.lastFire = t; S.flashCount++; S.lastFlashAt = t;
        list.forEach((i) => S.manualHold.add(i));
      } else list.forEach((i) => S.manualHold.delete(i));
    },
    setStrobeHeld(on) { if (on && !this.accept('manual')) return; S.strobeHeld = on; S.nextStrobe = 0; },

    setMode(m) {
      if (m === S.mode) return;
      const t = now();
      S.mode = m; S.step = -1;
      S.manualHold.clear(); S.strobeHeld = false;
      S.panels.forEach((p) => { p.gate = false; p.t0 = -1e12; });
      cfg().mode = m; D.config.save();
      D.bus.emit('mode', m);
    },
    setBlackout(on) {
      if (on === S.blackout) return;
      S.blackout = on;
      if (!on) S.fadeStart = now();
      D.bus.emit('blackout', on);
    },
    testPanel(i, on) { if (on) S.test.panels.add(i); else S.test.panels.delete(i); D.bus.emit('test'); },
    testAll(on) { S.test.all = on; D.bus.emit('test'); },
    clearTests() { S.test.panels.clear(); S.test.all = false; D.bus.emit('test'); },

    /* ---- per-tick evaluation ---- */
    tick(t) {
      const c = cfg();
      // manual hold-to-strobe at the (safety limited) speed
      if (S.mode === 'manual' && S.strobeHeld && t >= S.nextStrobe) {
        const hz = Math.min(c.output.speedHz, effMaxHz());
        S.nextStrobe = t + 1000 / hz;
        this._fire({ gate: false }, t);
      }
      const col = S.mode === 'manual' ? (c.manual.hardWhite ? [255, 255, 255] : S.colour.manual) : S.colour[S.mode];
      let bright = Math.min(c.output.brightness, effMaxBright()) / 100;
      if (S.mode === 'tiger') bright *= S.master.tiger;
      let fade = 1;
      if (S.blackout) fade = 0;
      else if (c.safety.fadeInMs > 0) fade = D.util.clamp((t - S.fadeStart) / c.safety.fadeInMs, 0, 1);
      bright *= fade; S.brightEff = bright; S.fade = fade;
      for (let i = 0; i < N; i++) {
        let lv = level(S.panels[i], t);
        if (S.mode === 'manual' && S.manualHold.has(i)) lv = 1;
        S.levels[i] = lv;
        let r = col[0] * lv * bright, g = col[1] * lv * bright, b = col[2] * lv * bright;
        const cc = S.cols[i];
        cc[0] = col[0] * bright; cc[1] = col[1] * bright; cc[2] = col[2] * bright; S.alpha[i] = lv;
        if (!S.blackout && (S.test.all || S.test.panels.has(i))) { // steady test light (not a flash)
          const tl = Math.min(0.45, Math.min(c.output.brightness, effMaxBright()) / 100);
          r = Math.max(r, 255 * tl); g = Math.max(g, 255 * tl); b = Math.max(b, 255 * tl);
          if (tl > lv * bright) { cc[0] = cc[1] = cc[2] = 255; S.alpha[i] = tl; }
        }
        const o = S.out[i]; o[0] = r + 0.5 | 0; o[1] = g + 0.5 | 0; o[2] = b + 0.5 | 0;
      }
    },
    reset() { S.panels.forEach((p) => { p.gate = false; p.t0 = -1e12; }); S.step = -1; }
  };
})();
