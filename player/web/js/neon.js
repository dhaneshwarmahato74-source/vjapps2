/* Neon borders – animated glowing edges on the OUTER outline of the diamond wall (the blue path), 20 styles, optional audio auto-switching.
   Drawn into the 4000x500 output (each 500x500 tile = one cabinet) so the LED wall, wall preview and Output window all show the same thing.
   Quality: soft glow is rendered on a separate low-res layer and up-sampled smoothly, the sharp core is drawn at full resolution on top. */
(function () {
  'use strict';
  const D = window.DLS, L = D.layout, P = L.PANEL;
  const PAL = {
    neon: ['#ff2bd6', '#8a5cff', '#29e6ff', '#3dffb0'], rainbow: ['#ff2a2a', '#ffb020', '#f6ff30', '#30ff7a', '#20d8ff', '#6a5cff', '#ff2bd6'],
    fire: ['#ff2a2a', '#ff8a1f', '#ffd21f'], ice: ['#00e5ff', '#4da3ff', '#b388ff'], pink: ['#ff2bd6', '#ff7ae6'], cyan: ['#00e5ff', '#8ff6ff'],
    green: ['#39ff88', '#c4ff4d'], white: ['#ffffff', '#bfe8ff'], electric: ['#1f5bff', '#4aa8ff', '#e6f6ff'], storm: ['#6a3dff', '#b79cff', '#ffffff'],
    aurora: ['#39ff88', '#29e6ff', '#8a5cff'], heart: ['#ff2a5a', '#ff8aa8'], candy: ['#ff2bd6', '#ffffff'], matrix: ['#0a8a30', '#39ff88', '#c6ffd8'],
    frost: ['#6fc3ff', '#9fe9ff', '#e8fbff'], glitch: ['#29e6ff', '#ff2bd6'],
    lava: ['#4a0500', '#ff2a00', '#ff9a00', '#ffe28a'], ocean: ['#0a3cff', '#00a8ff', '#7ff6ff'], vu: ['#22d85c', '#7cf04a', '#f3f23e', '#ffa53a', '#ff3a2e'], spark: ['#ff8a1f', '#ffd24d', '#ffffff']
  };
  const RGB = {}; Object.keys(PAL).forEach((k) => { RGB[k] = PAL[k].map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]); });
  const frac = (x) => x - Math.floor(x);
  const hash = (n) => { n = Math.sin(n * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); };
  const vn = (x) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f), a = hash(i); return a + (hash(i + 1) - a) * u; }; // smooth value noise 0..1
  function pal(name, u) { // colour at position u (wraps) of a palette
    const a = RGB[name] || RGB.neon, n = a.length, x = frac(u) * n, i = Math.floor(x), f = x - i, p = a[i % n], q = a[(i + 1) % n];
    return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f];
  }
  const rgba = (c, a) => 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + (a < 0 ? 0 : a > 1 ? 1 : a).toFixed(3) + ')';
  const core = (c) => [c[0] + (255 - c[0]) * 0.62, c[1] + (255 - c[1]) * 0.62, c[2] + (255 - c[2]) * 0.62];

  /* ---- the 20 styles ---- */
  const STYLES = [
    { id: 'electric', label: 'Electric Arc', pal: 'electric', jag: 1 }, { id: 'storm', label: 'Lightning Storm', pal: 'storm', jag: 1 },
    { id: 'fire', label: 'Fire', pal: 'fire', jag: 1 }, { id: 'plasma', label: 'Plasma', pal: 'neon', jag: 1 },
    { id: 'tube', label: 'Neon Tube', pal: 'neon' }, { id: 'comet', label: 'Comet Chase', pal: 'neon' },
    { id: 'laser', label: 'Laser Beam', pal: 'cyan' }, { id: 'rainbow', label: 'Rainbow Flow', pal: 'rainbow' },
    { id: 'aurora', label: 'Aurora', pal: 'aurora', jag: 1 }, { id: 'breath', label: 'Breathing', pal: 'neon' },
    { id: 'heartbeat', label: 'Heartbeat', pal: 'heart' }, { id: 'wave', label: 'Panel Wave', pal: 'neon' },
    { id: 'marching', label: 'Marching Lights', pal: 'neon' }, { id: 'sparkle', label: 'Sparkle Stars', pal: 'white' },
    { id: 'matrix', label: 'Digital Matrix', pal: 'matrix' }, { id: 'glitch', label: 'RGB Glitch', pal: 'glitch', jag: 1 },
    { id: 'frost', label: 'Frost Crystal', pal: 'frost', jag: 1 }, { id: 'candy', label: 'Candy Stripe', pal: 'candy' },
    { id: 'disco', label: 'Disco Blocks', pal: 'rainbow' }, { id: 'solid', label: 'Solid Glow', pal: 'neon' },
    { id: 'ripple', label: 'Ripple Rings', pal: 'cyan' }, { id: 'meteor', label: 'Meteor Shower', pal: 'ice' },
    { id: 'lava', label: 'Molten Lava', pal: 'lava', jag: 1 }, { id: 'ocean', label: 'Ocean Swell', pal: 'ocean', jag: 1 },
    { id: 'neonsign', label: 'Neon Sign', pal: 'pink' }, { id: 'dna', label: 'DNA Helix', pal: 'neon', jag: 1 },
    { id: 'confetti', label: 'Confetti', pal: 'rainbow' }, { id: 'meter', label: 'Audio Meter', pal: 'vu' },
    { id: 'prism', label: 'Prism RGB', pal: 'white' }, { id: 'sparks', label: 'Welding Sparks', pal: 'spark' }
  ];
  const SID = {}; STYLES.forEach((x) => { SID[x.id] = x; });
  const state = { cur: 'electric', beats: 0, last: 0, lvS: 0 };
  let curLv = -1;

  /* audio auto-switching: every N beats move to the next style of the pool (random or in sequence) */
  const pool = (c) => STYLES.map((x) => x.id).filter((id) => (c.off || []).indexOf(id) < 0);
  function nextStyle(c) {
    const p = pool(c); if (!p.length) return;
    if (c.autoOrder === 'sequence') state.cur = p[(p.indexOf(state.cur) + 1) % p.length];
    else { let n; do { n = p[(Math.random() * p.length) | 0]; } while (p.length > 1 && n === state.cur); state.cur = n; }
    state.last = performance.now(); D.bus.emit('neonstyle', state.cur);
  }
  D.bus.on('beat', () => {
    const c = D.config && D.config.get().neon; if (!c || !c.on || !c.auto) return;
    if (++state.beats >= Math.max(1, +c.autoBeats || 8)) { state.beats = 0; nextStyle(c); }
  });
  /* no audio running -> optional timer so auto-switching still works; with audio it follows the beats */
  setInterval(() => {
    const c = D.config && D.config.get().neon, au = D.audio; if (!au || !c || !c.on || !c.auto || au.running) return;
    const sec = +c.autoSec || 0; if (sec > 0 && performance.now() - state.last > sec * 1000) nextStyle(c);
  }, 250);
  /* live audio level 0..1 (normalised by the slow peak), -1 when no audio is running */
  function audioLevel() {
    const au = D.audio; if (!au || !au.running) return -1;
    const v = Math.min(1, au.level / Math.max(0.15, au.peak.bass, au.peak.mid, au.peak.treble));
    state.lvS = Math.max(v, state.lvS * 0.9); return state.lvS;
  }
  function status(c) { const au = D.audio, n = Math.max(1, +c.autoBeats || 8); return { listening: !!(au && au.running), bpm: au ? au.bpm : 0, left: Math.max(0, n - state.beats), sec: +c.autoSec || 0 }; }
  const curStyle = (cfg) => { const id = cfg.auto ? (cfg.cur || state.cur) : cfg.style; return SID[id] ? id : 'electric'; };

  /* sequence position (0..7) of the tile in processor slot s */
  function orderOf(cfg) {
    const wm = D.wallmap, cab = (s) => (wm ? wm.slotCab(s) : s), lab = (c) => (wm ? wm.label(c) : c + 1);
    const o = cfg.order || 'wiring', k = new Array(L.COUNT);
    for (let s = 0; s < L.COUNT; s++) {
      if (o === 'wiring') k[s] = s;                       // cable chain: slot 1 -> 8
      else if (o === 'reverse') k[s] = L.COUNT - 1 - s;
      else if (o === 'together') k[s] = 0;
      else if (o === 'panel') k[s] = lab(cab(s)) - 1;     // P1 -> P8 as printed on the cabinets, wherever they are cabled
      else k[s] = s;
    }
    if (o === 'custom') { // "1,2,4,3,5,6,7,8" = panel (P) numbers in the order they should light
      const list = String(cfg.custom || '').split(/[^0-9]+/).filter(Boolean).map(Number), seen = {};
      const rank = []; list.forEach((n) => { if (!seen[n]) { seen[n] = 1; rank.push(n); } });
      for (let s = 0; s < L.COUNT; s++) { const lb = lab(cab(s)), i = rank.indexOf(lb); k[s] = i >= 0 ? i : rank.length + s; }
    }
    return k;
  }
  let okey = '', ocache = null;
  function seq(cfg) { // cached: re-computed only when order / wiring changes
    const key = (cfg.order || '') + '|' + (cfg.custom || '') + '|' + (D.wallmap ? D.wallmap.json() : '');
    if (key !== okey) { okey = key; ocache = orderOf(cfg); }
    return ocache;
  }

  /* ---- the outline: only the part of each edge that is NOT covered by a neighbouring diamond gets a border ----
     Works on the real geometry (positions + rotation of every cabinet), so half-covered edges (e.g. P1 over P3) and any new wiring / layout are handled automatically. */
  const S2 = Math.SQRT1_2, H = S2 / 2, EPS = 1e-3;
  const NRM = [[0, -1], [1, 0], [0, 1], [-1, 0]];             // outward normals of tile edges: top, right, bottom, left (clockwise)
  const CORN = [[-1, -1], [1, -1], [1, 1], [-1, 1]];          // tile corners TL TR BR BL
  const tileTheta = (c) => { const wm = D.wallmap; return wm && wm.theta ? wm.theta(c) : Math.PI / 4; };

  /* exposed pieces of cabinet c, clockwise, starting right after a covered part: [{ e: edge 0-3, f0, f1 }] */
  function exposedPieces(c) {
    const p = L.panels[c], th = tileTheta(c), ct = Math.cos(th), st = Math.sin(th);
    const others = []; L.panels.forEach((q, j) => { if (j !== c) others.push({ q, c2: Math.cos(tileTheta(j)), s2: Math.sin(tileTheta(j)) }); });
    const free = (q) => {
      q = ((q % 4) + 4) % 4; const e = Math.min(3, Math.floor(q)), f = q - e, A = CORN[e], B = CORN[(e + 1) % 4];
      const lx = (A[0] + (B[0] - A[0]) * f) * H, ly = (A[1] + (B[1] - A[1]) * f) * H;
      const px = p.x + lx * ct - ly * st + (NRM[e][0] * ct - NRM[e][1] * st) * 0.03, py = p.y + lx * st + ly * ct + (NRM[e][0] * st + NRM[e][1] * ct) * 0.03;
      for (let i = 0; i < others.length; i++) { // is the point just outside this edge inside another diamond?
        const o = others[i], dx = px - o.q.x, dy = py - o.q.y;
        if (Math.abs(dx * o.c2 + dy * o.s2) <= H + 1e-6 && Math.abs(-dx * o.s2 + dy * o.c2) <= H + 1e-6) return false;
      }
      return true;
    };
    const M = 480, a = [];
    for (let i = 0; i < M; i++) a.push(free((i + 0.5) / M * 4));
    if (a.every(Boolean)) return [0, 1, 2, 3].map((e) => ({ e, f0: 0, f1: 1 }));
    if (!a.some(Boolean)) return [];
    const bis = (lo, hi, loState) => { for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (free(mid) === loState) lo = mid; else hi = mid; } return (lo + hi) / 2; };
    let k0 = 0; for (let i = 0; i < M; i++) if (a[i] && !a[(i + M - 1) % M]) { k0 = i; break; } // first sample after a covered stretch
    const runs = []; let cur = null;
    for (let n = 0; n < M; n++) {
      const i = (k0 + n) % M, q = (k0 + n + 0.5) / M * 4;
      if (a[i] && !cur) { cur = { qa: n === 0 ? (k0 + 0.5) / M * 4 - 0.5 / M * 4 : bis(q - 4 / M, q, false) }; }
      if (!a[i] && cur) { cur.qb = bis(q - 4 / M, q, true); runs.push(cur); cur = null; }
    }
    if (cur) { cur.qb = (k0 + M) / M * 4; runs.push(cur); }
    const out = [];
    runs.forEach((r) => { let pos = r.qa; while (pos < r.qb - 1e-6) { const fl = Math.floor(pos + 1e-9), end = Math.min(r.qb, fl + 1); out.push({ e: ((fl % 4) + 4) % 4, f0: pos - fl, f1: end - fl }); pos = end; } });
    return out.filter((pc) => pc.f1 - pc.f0 > 0.02); // drop numerical slivers
  }

  let pkey = '', pcache = null;
  function buildPath(cfg, K) {
    const cnt = L.COUNT, wm = D.wallmap, tiles = [];
    for (let s = 0; s < cnt; s++) tiles.push(s);
    const together = cfg.order === 'together';
    tiles.sort((x, y) => K[x] - K[y] || x - y); // follow the chosen order (wiring by default)
    const items = [], glen = []; let off = 0;
    tiles.forEach((s) => {
      if (together) off = 0;
      const pcs = exposedPieces(wm ? wm.slotCab(s) : s), start = items.length;
      pcs.forEach((pc, i) => {
        const pv = pcs[(i + pcs.length - 1) % pcs.length], nx = pcs[(i + 1) % pcs.length], len = pc.f1 - pc.f0;
        items.push({ s, e: pc.e, f0: pc.f0, f1: pc.f1, g: together ? s : 0, off, len, k: K[s],
          pe: pcs.length > 0 && pv !== pc && pv.e === (pc.e + 3) % 4 && pv.f1 >= 1 - EPS && pc.f0 <= EPS,   // continues round the corner -> fill the corner
          ne: pcs.length > 0 && nx !== pc && nx.e === (pc.e + 1) % 4 && pc.f1 >= 1 - EPS && nx.f0 <= EPS });
        off += len;
      });
      if (together) glen[s] = off;
    });
    if (!together) glen[0] = off;
    return { items, glen };
  }
  function path(cfg) {
    const K = seq(cfg), key = okey + '|' + (cfg.order === 'together') + '|' + JSON.stringify(L.panels.map((q, i) => [q.x, q.y, tileTheta(i)]));
    if (!pcache || key !== pkey) { pkey = key; pcache = buildPath(cfg, K); }
    return pcache;
  }


  /* ---- per-sample look of every style: fills O ---- */
  const O = { I: 1, pos: 0, off: 0, wf: 1, spike: 0, tongue: 0, spark: 0, rgb: null, dot: 0, streak: 0, dual: 0 };
  const comet = (u, len, T, sp, tl, add) => { const h = frac(T * sp * 0.2) * len + (add || 0), d = (((h - u) % len) + len) % len; return d < tl ? Math.pow(1 - d / tl, 1.5) : 0; };
  function sample(id, u, len, T, sp, ph, k, cnt, hue) {
    const x = u / len, F = Math.floor(T * 26 * Math.min(1.5, sp));
    let I = 1, pos = x * 0.9 + hue, off = 0, wf = 1, spike = 0, tongue = 0, spark = 0, rgb = null, dot = 0, streak = 0, dual = 0;
    switch (id) {
      case 'electric': // crackling lightning line with random branches (like a plasma / tesla frame)
        off = (vn(u * 70 + F * 9.3) - 0.5) * 13 + (vn(u * 19 + F * 3.7) - 0.5) * 9; I = 0.8 + 0.2 * vn(u * 9 + F * 2.1); wf = 0.5; pos = 0.4 + 0.45 * vn(u * 5 + F);
        if (hash(Math.floor(u * 16) + F * 13.7) > 0.92) spike = 16 + 26 * hash(Math.floor(u * 16) * 3.1 + F); break;
      case 'storm': { const fl = hash(Math.floor(T * sp * 2.1)) > 0.8 ? 1 : 0; // a few soft flashes per second at most
        off = (vn(u * 60 + F * 7.9) - 0.5) * 20 + (vn(u * 14 + F * 2.9) - 0.5) * 12; I = 0.5 + 0.5 * fl; wf = 0.55; pos = 0.2 + 0.7 * fl;
        if (hash(Math.floor(u * 14) + F * 11.3) > 0.86) spike = 22 + 34 * hash(Math.floor(u * 14) * 2.7 + F); break; }
      case 'fire': I = 0.6 + 0.4 * vn(u * 9 - T * sp * 4 + ph * 20); tongue = Math.pow(0.08 + 0.92 * vn(u * 15 - T * sp * 5.5 + ph * 9), 1.7) * 56; if (tongue < 7) tongue = 0; off = (vn(u * 30 - T * sp * 8) - 0.5) * 4; pos = 0.5 + 0.5 * vn(u * 5 - T * sp * 3); break;
      case 'plasma': off = Math.sin(6.2832 * (u * 1.1 - T * sp * 0.5)) * 6; wf = 1.0 + 0.3 * Math.sin(6.2832 * (u * 0.8 + T * sp * 0.3)); I = 0.78 + 0.22 * Math.sin(6.2832 * (u * 1.7 - T * sp * 0.7)); pos = x * 0.8 + T * sp * 0.12 + ph; break;
      case 'tube': { const tl = Math.max(2, len * 0.28); I = 0.55 + 0.45 * Math.max(comet(u, len, T, sp, tl), len > 10 ? comet(u, len, T, sp, tl, len / 2) : 0); pos = x * 0.7 + hue + ph; break; }
      case 'comet': { const tl = Math.max(2.2, len * 0.22); I = 0.1 + 0.9 * Math.max(comet(u, len, T, sp, tl), len > 10 ? comet(u, len, T, sp, tl, len / 2) : 0); break; }
      case 'laser': { const h = frac(T * sp * 0.35) * len, d1 = (((h - u) % len) + len) % len, d2 = (((u - (len - h)) % len) + len) % len, b = Math.max(d1 < 1.2 ? 1 - d1 / 1.2 : 0, d2 < 1.2 ? 1 - d2 / 1.2 : 0); I = 0.12 + 0.88 * b; wf = 0.4 + 0.6 * b; pos = 0.15 + 0.7 * b; break; }
      case 'rainbow': I = 0.92; pos = x + T * sp * 0.2; break;
      case 'aurora': wf = 1.5; I = 0.5 + 0.4 * Math.sin(6.2832 * (u * 0.35 - T * sp * 0.12)); off = 8 * Math.sin(u * 0.8 + T * sp * 0.5); pos = 0.5 + 0.5 * Math.sin(u * 0.25 + T * sp * 0.2); break;
      case 'breath': I = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(6.2832 * (T * sp * 0.4 - ph))); pos = ph + hue; break;
      case 'heartbeat': { const p = frac(T * sp * 0.9), a = (p - 0.06) / 0.05, b = (p - 0.25) / 0.06; I = 0.14 + 0.86 * Math.min(1, Math.exp(-a * a) + 0.7 * Math.exp(-b * b)); pos = ph * 0.3; break; }
      case 'wave': { const d = (((T * sp * 1.4) % cnt) - k + cnt) % cnt; I = 0.1 + 0.9 * (d < 1.1 ? 1 : Math.exp(-(d - 1.1) * 1.05)); pos = ph + hue; break; }
      case 'marching': I = frac(u * 2.6 - T * sp * 1.1) < 0.5 ? 1 : 0.08; pos = x + hue; break;
      case 'sparkle': I = 0.28 + 0.12 * vn(u * 8 + T); pos = hash(Math.floor(u * 22)) * 0.9; if (hash(Math.floor(u * 22) + Math.floor(T * sp * 7) * 19) > 0.955) { spark = 1; I = 1; } break;
      case 'matrix': { const b = Math.floor(u * 7), fr = Math.floor(T * sp * 5.5); I = hash(b * 7.1 + fr) > 0.42 ? 1 : 0.07; pos = 0.4 + 0.5 * hash(b + fr); break; }
      case 'glitch': I = 0.95; off = hash(Math.floor(u * 5) + Math.floor(T * sp * 9) * 3.7) > 0.9 ? (hash(Math.floor(u * 5) + 7 + Math.floor(T * sp * 9)) - 0.5) * 30 : 0; break;
      case 'frost': I = 0.55 + 0.45 * vn(u * 22 + T * sp * 2); tongue = hash(Math.floor(u * 34)) > 0.5 ? 20 : 9; pos = 0.4 + 0.4 * vn(u * 3 + T * sp * 0.3); break;
      case 'candy': pos = frac(u * 2.2 - T * sp * 0.5) < 0.5 ? 0 : 0.5; I = 1; break;
      case 'disco': pos = hash(Math.floor(u * 3) * 3.3 + Math.floor(T * sp * 1.5)); I = 0.95; break;
      case 'ripple': { let r = 0.1; for (let m = 0; m < 4; m++) { const life = frac(T * sp * 0.25 + m * 0.25), pm = (m + 0.5 + 0.3 * hash(m * 4.1 + Math.floor(T * sp * 0.25 + m * 0.25))) / 4 * len, rad = life * len * 0.22; let d = Math.abs(u - pm); d = Math.min(d, len - d); const g = Math.exp(-Math.pow((d - rad) / 0.32, 2)) * (1 - life); if (g > r) r = g; } I = r; wf = 0.8 + 0.5 * r; pos = 0.2 + 0.6 * r + hue; break; }
      case 'meteor': { let b = 0; for (let m = 0; m < 4; m++) { const dir = m % 2 ? -1 : 1, h = frac(T * sp * (0.11 + 0.045 * m) * dir + m * 0.27) * len, d = dir > 0 ? (((h - u) % len) + len) % len : (((u - h) % len) + len) % len; if (d < 3.2) b = Math.max(b, Math.pow(1 - d / 3.2, 1.4)); } I = 0.05 + 0.95 * b; wf = 0.45 + 0.7 * b; pos = 0.1 + 0.8 * b; break; }
      case 'lava': I = 0.5 + 0.5 * vn(u * 3 - T * sp * 0.6); wf = 0.8 + 0.9 * vn(u * 2.2 + T * sp * 0.35); off = (vn(u * 5 + T * sp * 0.8) - 0.5) * 8; pos = vn(u * 2.4 - T * sp * 0.3) * 0.95 + 0.02; break;
      case 'ocean': { const a = 6.2832 * (u * 0.9 - T * sp * 0.35), sw = 0.5 + 0.5 * Math.sin(a); wf = 0.7 + 0.7 * sw; I = 0.5 + 0.5 * sw; off = 5 * Math.sin(a + 1.2); pos = 0.15 + 0.6 * sw; if (sw > 0.985) spark = 1; break; }
      case 'neonsign': { const b = Math.floor(u * 4), fl = Math.floor(T * sp * 3); I = hash(b * 5.3 + fl) > 0.9 ? (hash(fl * 1.7 + b) > 0.5 ? 0.85 : 0.14) : 0.93 + 0.07 * vn(T * 30 + u); pos = 0.03; break; }
      case 'dna': off = 9 * Math.sin(6.2832 * (u * 1.4 - T * sp * 0.5)); pos = 0.1 + hue; wf = 0.7; dual = 1; break;
      case 'confetti': { const c = Math.floor(u * 18), lf = frac(T * sp * 0.8 + hash(c) * 3); I = 0.22; pos = hash(c * 2.3 + 1); if (hash(c * 1.7 + Math.floor(T * sp * 0.8 + hash(c) * 3)) > 0.55 && frac(u * 18) < 0.3) dot = 1 - lf; break; }
      case 'meter': { const lv = curLv >= 0 ? curLv : 0.5 + 0.45 * Math.sin(T * sp * 1.3) * Math.sin(T * 0.37 + 1), lit = Math.floor(u * 3) / 3 < lv * len; I = lit ? 1 : 0.1; wf = lit ? 1 : 0.6; pos = Math.min(0.99, x * 0.97); break; }
      case 'prism': { const tl = Math.max(2, len * 0.2), h = frac(T * sp * 0.2) * len, cm = (o) => { const d = (((h - o - u) % len) + len) % len; return d < tl ? Math.pow(1 - d / tl, 1.4) : 0; }; const r = cm(0), g = cm(len * 0.04), b = cm(len * 0.08); rgb = [30 + 225 * r, 30 + 225 * g, 30 + 225 * b]; I = 0.12 + 0.88 * Math.max(r, g, b); break; }
      case 'sparks': { const c = Math.floor(u * 10), fr = Math.floor(T * sp * 5 + hash(c) * 5), lf = frac(T * sp * 5 + hash(c) * 5); I = 0.3 + 0.2 * vn(u * 6 + T * 3); pos = 0.5; if (hash(c * 3.1 + fr) > 0.55) { I = 0.9; pos = 0.9; if (frac(u * 10) < 0.25) streak = (14 + 40 * hash(c * 1.3 + fr)) * (1 - lf * 0.7); } break; }
      default: pos = ph + hue; I = 1;
    }
    O.I = I; O.pos = pos; O.off = off; O.wf = wf; O.spike = spike; O.tongue = tongue; O.spark = spark; O.rgb = rgb; O.dot = dot; O.streak = streak; O.dual = dual;
  }

  /* soft-glow layer (1/4 resolution, up-sampled with smoothing = cheap, clean blur) */
  const LAY = {};
  function layer(name) { // low-res helper canvas (1/4 size) for soft glow / shadow; up-sampling with smoothing = clean blur
    if (LAY[name] === undefined) { try { const cv = document.createElement('canvas'); cv.width = L.OUT_W / 4; cv.height = L.OUT_H / 4; LAY[name] = { cv, g: cv.getContext('2d') }; } catch (e) { LAY[name] = false; } }
    return LAY[name] || null;
  }
  const px = [], py = [], bx = [], by = [], pO = [], pI = [], pPos = [], pWf = [], pSp = [], pTg = [], pSk = [], pRgb = [], pDot = [], pStr = [], pDual = [];
  function draw(ctx, cfg, t, level) {
    if (!cfg || !cfg.on || level <= 0.003) return;
    curLv = cfg.lv != null ? cfg.lv : audioLevel();
    const sid = curStyle(cfg), STY = SID[sid], K = seq(cfg), PH = path(cfg), name = cfg.palette && cfg.palette !== 'auto' && PAL[cfg.palette] ? cfg.palette : STY.pal;
    const sp = Math.max(0.05, +cfg.speed || 1), w = Math.max(3, +cfg.width || 12), T = t / 1000, cnt = L.COUNT;
    const ultra = cfg.ultra == null ? true : !!cfg.ultra, blend = cfg.blend || 'screen', dim = Math.max(0, Math.min(100, cfg.dim == null ? 40 : +cfg.dim)) / 100;
    const glow = Math.max(0, Math.min(100, cfg.glow == null ? 70 : +cfg.glow)) / 100 * (ultra ? 1.6 : 1);
    const gk = blend === 'add' ? 0.75 : blend === 'normal' ? 0.8 : 1, opMain = 'source-over', opGlow = blend === 'normal' ? 'source-over' : blend === 'screen' ? 'screen' : 'lighter';
    const ins = w * 0.5 + 11, side = P - ins * 2, hue = T * sp * 0.1, cap = STY.jag ? 'round' : 'butt';
    const cr = [[0, 0], [side, 0], [side, side], [0, side]];
    const G = glow > 0 ? layer('glow') : null, gx = G && G.g;
    if (gx) { gx.setTransform(1, 0, 0, 1, 0, 0); gx.clearRect(0, 0, G.cv.width, G.cv.height); gx.setTransform(0.25, 0, 0, 0.25, 0, 0); gx.lineCap = 'round'; gx.lineJoin = 'round'; }
    ctx.save(); ctx.lineJoin = 'round';
    const SL = dim > 0 ? layer('shadow') : null;
    if (SL) { // soft dark halo under the border -> neon stays readable on bright video
      const sx = SL.g, a = Math.min(1, dim * Math.min(1, level * 1.4));
      sx.setTransform(1, 0, 0, 1, 0, 0); sx.clearRect(0, 0, SL.cv.width, SL.cv.height); sx.setTransform(0.25, 0, 0, 0.25, 0, 0); sx.lineCap = 'round'; sx.lineJoin = 'round';
      for (let s2 = 0; s2 < cnt; s2++) {
        const its = PH.items.filter((x) => x.s === s2); if (!its.length) continue;
        sx.save(); sx.beginPath(); sx.rect(s2 * P, 0, P, P); sx.clip(); sx.beginPath();
        its.forEach((it) => { const A = cr[it.e], B = cr[(it.e + 1) % 4], dx = (B[0] - A[0]) / side, dy = (B[1] - A[1]) / side, ox = s2 * P + ins, oy = ins; sx.moveTo(ox + A[0] + dx * it.f0 * side, oy + A[1] + dy * it.f0 * side); sx.lineTo(ox + A[0] + dx * it.f1 * side, oy + A[1] + dy * it.f1 * side); });
        [[ultra ? 7 : 5, 0.34], [ultra ? 4.6 : 3.4, 0.42], [ultra ? 2.8 : 2.1, 0.5]].forEach((q) => { sx.lineWidth = w * q[0]; sx.strokeStyle = 'rgba(0,0,0,' + (q[1] * a).toFixed(3) + ')'; sx.stroke(); });
        sx.restore();
      }
      ctx.globalCompositeOperation = 'source-over'; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(SL.cv, 0, 0, L.OUT_W, L.OUT_H);
    }
    PH.items.forEach((it) => {
      const len = PH.glen[it.g], k = it.k, ph = k / cnt, ox = it.s * P + ins, oy = ins;
      const A = cr[it.e], B = cr[(it.e + 1) % 4], dx = (B[0] - A[0]) / side, dy = (B[1] - A[1]) / side, nx = -NRM[it.e][0], ny = -NRM[it.e][1]; // (nx,ny) points to the tile centre
      const n = Math.max(2, Math.ceil(it.len * side / 12));
      for (let i = 0; i <= n; i++) {
        const f = (it.f0 + (it.f1 - it.f0) * i / n) * side + (i === 0 && it.pe ? -w / 2 : 0) + (i === n && it.ne ? w / 2 : 0);
        sample(sid, it.off + it.len * i / n, len, T, sp, ph, k, cnt, hue);
        const o = (i === 0 || i === n) ? O.off * 0.4 : O.off;
        bx[i] = ox + A[0] + dx * f; by[i] = oy + A[1] + dy * f; pO[i] = o; px[i] = bx[i] + nx * o; py[i] = by[i] + ny * o; pRgb[i] = O.rgb; pDot[i] = O.dot; pStr[i] = O.streak; pDual[i] = O.dual; pI[i] = O.I * level; pPos[i] = O.pos; pWf[i] = O.wf; pSp[i] = O.spike; pTg[i] = O.tongue; pSk[i] = O.spark;
      }
      ctx.save(); ctx.beginPath(); ctx.rect(it.s * P, 0, P, P); ctx.clip(); ctx.globalCompositeOperation = opMain;
      if (gx) { gx.save(); gx.beginPath(); gx.rect(it.s * P, 0, P, P); gx.clip(); }
      ctx.lineCap = cap;
      for (let i = 0; i < n; i++) {
        const Ia = pI[i]; if (Ia < 0.02) continue;
        const col = pRgb[i] || pal(name, pPos[i]), ww = w * pWf[i], hot = core(col);
        if (gx) { gx.lineWidth = w * pWf[i] * (1.7 + glow * 1.7); gx.strokeStyle = rgba(col, Ia * (0.1 + 0.34 * glow) * gk); gx.beginPath(); gx.moveTo(px[i], py[i]); gx.lineTo(px[i + 1], py[i + 1]); gx.stroke();
          if (ultra) { gx.lineWidth = w * pWf[i] * (5.5 + glow * 3); gx.strokeStyle = rgba(col, Ia * 0.075 * glow * gk); gx.stroke(); } }
        if (sid === 'glitch') { // three colour-shifted copies
          ctx.globalCompositeOperation = 'lighter'; ctx.lineWidth = ww * 0.7;
          ctx.strokeStyle = rgba(RGB.glitch[0], Ia * 0.85); ctx.beginPath(); ctx.moveTo(px[i] - nx * 4, py[i] - ny * 4); ctx.lineTo(px[i + 1] - nx * 4, py[i + 1] - ny * 4); ctx.stroke();
          ctx.strokeStyle = rgba(RGB.glitch[1], Ia * 0.85); ctx.beginPath(); ctx.moveTo(px[i] + nx * 4, py[i] + ny * 4); ctx.lineTo(px[i + 1] + nx * 4, py[i + 1] + ny * 4); ctx.stroke();
          ctx.globalCompositeOperation = opMain;
        } else { ctx.lineWidth = ww; ctx.strokeStyle = rgba(col, Ia); ctx.beginPath(); ctx.moveTo(px[i], py[i]); ctx.lineTo(px[i + 1], py[i + 1]); ctx.stroke(); }
        ctx.lineWidth = Math.max(1.5, ww * 0.34); ctx.strokeStyle = rgba(hot, Math.min(1, Ia * 1.1)); ctx.beginPath(); ctx.moveTo(px[i], py[i]); ctx.lineTo(px[i + 1], py[i + 1]); ctx.stroke(); // hot core
        if (pDual[i]) { // second strand of the helix (mirrored) + cross-bars where the strands meet
          const c2 = pal(name, pPos[i] + 0.5); ctx.lineWidth = ww; ctx.strokeStyle = rgba(c2, Ia); ctx.beginPath(); ctx.moveTo(bx[i] - nx * pO[i], by[i] - ny * pO[i]); ctx.lineTo(bx[i + 1] - nx * pO[i + 1], by[i + 1] - ny * pO[i + 1]); ctx.stroke();
          ctx.lineWidth = Math.max(1.5, ww * 0.34); ctx.strokeStyle = rgba(core(c2), Ia); ctx.stroke();
          if (i % 3 === 0) { ctx.lineWidth = Math.max(1.5, w * 0.16); ctx.strokeStyle = rgba(hot, Ia * 0.5); ctx.beginPath(); ctx.moveTo(px[i], py[i]); ctx.lineTo(bx[i] - nx * pO[i], by[i] - ny * pO[i]); ctx.stroke(); }
        }
        if (pDot[i] > 0) { // confetti dot
          const r = w * (0.4 + 0.9 * pDot[i]); ctx.fillStyle = rgba(col, 0.95); ctx.beginPath(); ctx.arc(px[i] + nx * 5, py[i] + ny * 5, r, 0, 6.2832); ctx.fill();
          if (gx) { gx.fillStyle = rgba(col, 0.4 * glow); gx.beginPath(); gx.arc(px[i] + nx * 5, py[i] + ny * 5, r * 2.2, 0, 6.2832); gx.fill(); }
        }
        if (pStr[i] > 0) { // welding spark streak flying towards the tile centre
          const Ls = pStr[i], jt = (hash(i * 2.9 + it.off * 7) - 0.5) * 0.7, ex = px[i] + nx * Ls + dx * Ls * jt, ey = py[i] + ny * Ls + dy * Ls * jt;
          ctx.lineWidth = Math.max(1.5, w * 0.26); ctx.strokeStyle = rgba(hot, Ia); ctx.beginPath(); ctx.moveTo(px[i], py[i]); ctx.lineTo(ex, ey); ctx.stroke();
          ctx.fillStyle = rgba(hot, 1); ctx.beginPath(); ctx.arc(ex, ey, Math.max(2, w * 0.22), 0, 6.2832); ctx.fill();
          if (gx) { gx.lineWidth = w * 1.2; gx.strokeStyle = rgba(col, Ia * 0.3 * glow); gx.beginPath(); gx.moveTo(px[i], py[i]); gx.lineTo(ex, ey); gx.stroke(); }
        }
        if (pSp[i] > 0) { // lightning branch
          const L2 = pSp[i], tx = dx * (hash(i * 3.3 + it.off) - 0.5) * 18, ty = dy * (hash(i * 3.3 + it.off) - 0.5) * 18;
          ctx.lineWidth = Math.max(1.5, w * 0.22); ctx.strokeStyle = rgba(hot, Ia * 0.9); ctx.beginPath(); ctx.moveTo(px[i], py[i]); ctx.lineTo(px[i] + nx * L2 * 0.5 + tx, py[i] + ny * L2 * 0.5 + ty); ctx.lineTo(px[i] + nx * L2 + tx * 1.6, py[i] + ny * L2 + ty * 1.6); ctx.stroke();
          if (gx) { gx.lineWidth = w * 0.9; gx.strokeStyle = rgba(col, Ia * 0.2 * glow); gx.beginPath(); gx.moveTo(px[i], py[i]); gx.lineTo(px[i] + nx * L2, py[i] + ny * L2); gx.stroke(); }
        }
        if (pTg[i] > 0) { // flame tongues / ice crystals: tapered shapes growing towards the tile centre
          const Ls = pTg[i], bw = sid === 'fire' ? 8 : 3.5, sw = sid === 'fire' ? (vn(i * 0.7 + T * sp * 7 + it.off * 9) - 0.5) * 12 : 0;
          [[0.05, 1, 0.45, 1], [0.55, 0.66, 0.72, 0.62], [0.95, 0.34, 0.92, 0.3]].forEach((q) => {
            const h = Ls * q[1], hw = bw * q[3] + 1.5;
            ctx.fillStyle = rgba(pal(name, q[0]), Ia * q[2]); ctx.beginPath(); ctx.moveTo(px[i] - dx * hw, py[i] - dy * hw);
            ctx.quadraticCurveTo(px[i] - dx * hw * 0.4 + nx * h * 0.55, py[i] - dy * hw * 0.4 + ny * h * 0.55, px[i] + nx * h + dx * sw * q[1], py[i] + ny * h + dy * sw * q[1]);
            ctx.quadraticCurveTo(px[i] + dx * hw * 0.4 + nx * h * 0.55, py[i] + dy * hw * 0.4 + ny * h * 0.55, px[i] + dx * hw, py[i] + dy * hw); ctx.closePath(); ctx.fill();
          });
          if (gx) { gx.lineWidth = w * 1.6; gx.strokeStyle = rgba(pal(name, 0.5), Ia * 0.2 * glow); gx.beginPath(); gx.moveTo(px[i], py[i]); gx.lineTo(px[i] + nx * Ls * 0.8, py[i] + ny * Ls * 0.8); gx.stroke(); }
        }
        if (pSk[i] > 0) { // sparkle: 4-point star
          const r = w * 1.7, q = r * 0.2; ctx.fillStyle = rgba(hot, 1); ctx.beginPath();
          ctx.moveTo(px[i] - r, py[i]); ctx.lineTo(px[i] - q, py[i] - q); ctx.lineTo(px[i], py[i] - r); ctx.lineTo(px[i] + q, py[i] - q); ctx.lineTo(px[i] + r, py[i]); ctx.lineTo(px[i] + q, py[i] + q); ctx.lineTo(px[i], py[i] + r); ctx.lineTo(px[i] - q, py[i] + q); ctx.closePath(); ctx.fill();
          if (gx) { gx.fillStyle = rgba(col, 0.45 * glow); gx.beginPath(); gx.arc(px[i], py[i], w * 1.6, 0, 6.2832); gx.fill(); }
        }
      }
      if (gx) gx.restore();
      ctx.restore();
    });
    if (gx) { ctx.globalCompositeOperation = opGlow; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(G.cv, 0, 0, L.OUT_W, L.OUT_H); ctx.globalCompositeOperation = 'source-over'; }
    ctx.restore();
  }

  /* settings + safety cap + blackout fade -> one render level (0..1) */
  const level = (cfg, S, cap) => Math.min((cfg.brightness == null ? 100 : cfg.brightness) / 100, (cap == null ? 100 : cap) / 100) * (S && S.fade != null ? S.fade : 1);
  /* order as it will run: [{ p: panel label (P?), slot }] */
  function describe(cfg) {
    const K = seq(cfg), wm = D.wallmap, out = [];
    for (let k = 0; k < 2 * L.COUNT; k++) for (let s = 0; s < L.COUNT; s++) if (K[s] === k) out.push({ p: wm ? wm.label(wm.slotCab(s)) : s + 1, slot: s + 1 });
    return cfg.order === 'together' ? [] : out;
  }
  D.neon = { draw, level, describe, audioLevel, status, outline: (cfg) => path(cfg || {}), STYLES, state, nextStyle, curStyle, pool, PALETTES: Object.keys(PAL) };
})();
