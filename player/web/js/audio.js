/* Audio beat-reactive mode: microphone / audio interface / uploaded file -> beats, bands, colours, pattern changes.
   Analysis only drives the wall while mode === 'audio'. */
(function () {
  'use strict';
  const D = window.DLS;
  const cfg = () => D.config.get();
  const HIST = 43;

  const A = D.audio = {
    ctx: null, analyser: null, src: null, stream: null, el: null, elSource: null, running: false, sourceKind: null,
    freq: null, prev: null,
    bands: { bass: 0, mid: 0, treble: 0 }, peak: { bass: 0.2, mid: 0.2, treble: 0.2 },
    flux: new Array(HIST).fill(0), fluxI: 0,
    beats: 0, lastBeat: -1e9, intervals: [], bpm: 0, beatFlashUntil: 0, level: 0,
    hue: Math.random() * 360, paletteIdx: 0, halfTimer: null, beatsSincePattern: 0, debug: { flux: 0, thr: 0 },

    async listDevices() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
      const d = await navigator.mediaDevices.enumerateDevices();
      return d.filter((x) => x.kind === 'audioinput');
    },
    _ensureCtx() {
      if (!A.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        A.ctx = new AC({ latencyHint: 'interactive' });
        A.analyser = A.ctx.createAnalyser();
        A.analyser.fftSize = 2048; A.analyser.smoothingTimeConstant = 0.15;
        A.analyser.minDecibels = -90; A.analyser.maxDecibels = -10;
        A.freq = new Uint8Array(A.analyser.frequencyBinCount);
        A.prev = new Float32Array(A.analyser.frequencyBinCount);
      }
      if (A.ctx.state === 'suspended') A.ctx.resume();
    },
    _disconnectInput() {
      if (A.src) { try { A.src.disconnect(); } catch (e) { /* ignore */ } A.src = null; }
      if (A.stream) { A.stream.getTracks().forEach((t) => t.stop()); A.stream = null; }
      if (A.elSource) { try { A.elSource.disconnect(); } catch (e) { /* ignore */ } }
    },
    async startInput(deviceId) {
      A._ensureCtx(); A._disconnectInput();
      const c = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } };
      if (deviceId) c.audio.deviceId = { exact: deviceId };
      A.stream = await navigator.mediaDevices.getUserMedia(c);
      A.src = A.ctx.createMediaStreamSource(A.stream);
      A.src.connect(A.analyser); // NOT connected to speakers (avoids feedback)
      A.sourceKind = 'input'; A.running = true;
      D.bus.emit('audio-state');
    },
    attachFile(audioEl) {
      A._ensureCtx(); A._disconnectInput();
      A.el = audioEl;
      if (!A.elSource) A.elSource = A.ctx.createMediaElementSource(audioEl);
      A.elSource.connect(A.analyser);
      A.elSource.connect(A.ctx.destination); // hear the file
      A.sourceKind = 'file'; A.running = true;
      D.bus.emit('audio-state');
    },
    stop() {
      A._disconnectInput(); A.running = false; A.sourceKind = null;
      if (A.el) A.el.pause();
      clearTimeout(A.halfTimer);
      D.bus.emit('audio-state');
    },

    _band(lo, hi) {
      const hz = A.ctx.sampleRate / A.analyser.fftSize;
      const a = Math.max(1, Math.floor(lo / hz)), b = Math.min(A.freq.length - 1, Math.ceil(hi / hz));
      let s = 0; for (let i = a; i <= b; i++) s += A.freq[i];
      return s / ((b - a + 1) * 255);
    },

    /* called every tick */
    process(t) {
      if (!A.running || !A.analyser) return;
      const S = D.state;
      A.analyser.getByteFrequencyData(A.freq);
      const bass = A._band(30, 150), mid = A._band(150, 2000), treble = A._band(2000, 12000);
      A.bands.bass = bass; A.bands.mid = mid; A.bands.treble = treble;
      A.level = Math.max(bass, mid, treble);
      ['bass', 'mid', 'treble'].forEach((k) => { A.peak[k] = Math.max(A.bands[k], A.peak[k] * 0.9985, 0.05); });

      // spectral flux over 30-300 Hz
      const hz = A.ctx.sampleRate / A.analyser.fftSize;
      const a = Math.max(1, Math.floor(30 / hz)), b = Math.ceil(300 / hz);
      let flux = 0;
      for (let i = a; i <= b; i++) { const v = A.freq[i]; const d = v - A.prev[i]; if (d > 0) flux += d; A.prev[i] = v; }
      flux /= (b - a + 1);
      A.flux[A.fluxI++ % HIST] = flux;
      let mean = 0; for (let i = 0; i < HIST; i++) mean += A.flux[i]; mean /= HIST;
      let varr = 0; for (let i = 0; i < HIST; i++) { const d = A.flux[i] - mean; varr += d * d; } varr /= HIST;
      const sens = cfg().audio.sensitivity / 100; // 0..1
      const c = 3.2 - sens * 2.5;                // 3.2 (strict) .. 0.7 (very sensitive)
      const thr = mean + c * Math.sqrt(varr) + (1.5 - sens);
      A.debug.flux = flux; A.debug.thr = thr;
      const minGap = Math.max(120, cfg().audio.minGapMs), isBeat = flux > thr && flux > 2.0 && (t - A.lastBeat) > minGap && A.level > 0.05;
      if (S.mode !== 'audio') { if (isBeat) A._beatLight(t); return; } // other modes: only report the beat (BPM display, neon auto-switch) – nothing drives the wall
      if (isBeat) A._beat(t);
    },

    /* beat seen while NOT in Audio mode: bookkeeping + 'beat' event only (the wall is driven by its own control source) */
    _beatLight(t) {
      if (A.lastBeat > 0) { const iv = t - A.lastBeat; if (iv < 1500) { A.intervals.push(iv); if (A.intervals.length > 8) A.intervals.shift(); } else A.intervals = []; }
      if (A.intervals.length >= 3) { const sI = A.intervals.slice().sort((x, y) => x - y); A.bpm = Math.round(60000 / sI[sI.length >> 1]); }
      A.lastBeat = t; A.beats++; A.beatFlashUntil = t + 90;
      D.bus.emit('beat');
    },

    _beat(t) {
      const au = cfg().audio;
      if (A.lastBeat > 0) {
        const iv = t - A.lastBeat;
        if (iv < 1500) { A.intervals.push(iv); if (A.intervals.length > 8) A.intervals.shift(); }
        else A.intervals = [];
      }
      if (A.intervals.length >= 3) {
        const s = A.intervals.slice().sort((x, y) => x - y);
        const med = s[s.length >> 1]; A.bpm = Math.round(60000 / med);
      }
      A.lastBeat = t; A.beats++; A.beatFlashUntil = t + 90;
      D.bus.emit('beat');
      // colour on every real beat
      A._colour();
      // pattern advance by beat count (follows music, not a timer)
      A.beatsSincePattern++;
      const bpp = au.beatsPerPattern | 0;
      if (bpp > 0 && A.beatsSincePattern >= bpp) { A.beatsSincePattern = 0; D.engine.advancePattern('audio', 1); }

      D.video.onBeat();
      // video change follows the music (not the pattern sequence)
      A.beatsSinceVideo = (A.beatsSinceVideo || 0) + 1;
      const bpv = au.beatsPerVideo | 0;
      if (bpv > 0 && A.beatsSinceVideo >= bpv) { A.beatsSinceVideo = 0; D.video.change('audio'); }

      // beat division
      const div = au.division;
      if (div === '2') {
        D.engine.trigger('audio', { gate: false });
        clearTimeout(A.halfTimer);
        if (A.intervals.length) {
          const s = A.intervals.slice().sort((x, y) => x - y); const med = s[s.length >> 1];
          A.halfTimer = setTimeout(() => { if (D.state.mode === 'audio') D.engine.trigger('audio', { gate: false }); }, med / 2);
        }
      } else {
        // '1' = every beat, '1/2' = every 2nd beat, '1/4', '1/8' ...
        const every = div.indexOf('/') > 0 ? (parseInt(div.split('/')[1], 10) || 1) : 1;
        if ((A.beats - 1) % every === 0) D.engine.trigger('audio', { gate: false });
      }
    },

    _colour() {
      const mode = cfg().audio.colorMode;
      const list = D.palette.enabled();
      let rgb;
      if (mode === 'white') rgb = [255, 255, 255];
      else if (mode === 'hue') { // random enabled colour, never the same twice in a row
        let c; for (let k = 0; k < 6; k++) { c = list[Math.floor(Math.random() * list.length)]; if (list.length < 2 || c !== A.lastCol) break; }
        A.lastCol = c; rgb = c.rgb;
      }
      else if (mode === 'palette') { A.lastCol = list[A.paletteIdx++ % list.length]; rgb = A.lastCol.rgb; }
      else { // bands: bass -> red, mid -> green, treble -> blue, then snapped to the nearest ENABLED saturated colour
        const n = [A.bands.bass / A.peak.bass, A.bands.mid / A.peak.mid, A.bands.treble / A.peak.treble].map((v) => Math.pow(D.util.clamp(v, 0, 1), 2.2));
        const m = Math.max(n[0], n[1], n[2], 0.001);
        rgb = D.palette.nearest(n.map((v) => 255 * v / m)).rgb;
      }
      D.engine.setColour('audio', rgb);
    }
  };
})();
