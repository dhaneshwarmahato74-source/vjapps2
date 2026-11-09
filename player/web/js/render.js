/* Rendering: 4000x500 processor frame + physical diamond wall preview + pattern thumbnails */
(function () {
  'use strict';
  const D = window.DLS;
  const L = D.layout;
  const P = L.PANEL;
  // processor slot <-> cabinet, from the shared wiring (identity when no calibration exists)
  const slotCab = (s) => (D.wallmap ? D.wallmap.slotCab(s) : s);
  const cabSlot = (c) => (D.wallmap ? D.wallmap.cabSlot(c) : c);
  const cabLabel = (c) => (D.wallmap ? D.wallmap.label(c) : c + 1);

  function drawOutput(ctx, panels, labels, overlayOnly) {
    if (!overlayOnly) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, L.OUT_W, L.OUT_H); }
    for (let s = 0; panels && s < L.COUNT; s++) { // tile s carries the cabinet wired to processor slot s
      const c = panels[slotCab(s)];
      if (c[0] | c[1] | c[2]) { ctx.fillStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; ctx.fillRect(s * P, 0, P, P); }
    }
    if (labels) {
      ctx.save();
      ctx.lineWidth = 6; ctx.strokeStyle = '#ff2bd6'; ctx.fillStyle = '#ff2bd6';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let i = 0; i < L.COUNT; i++) {
        const x = i * P;
        ctx.strokeStyle = i % 2 ? '#00e5ff' : '#ff2bd6'; ctx.fillStyle = ctx.strokeStyle;
        ctx.strokeRect(x + 3, 3, P - 6, P - 6);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + P, P); ctx.moveTo(x + P, 0); ctx.lineTo(x, P); ctx.globalAlpha = 0.35; ctx.stroke(); ctx.globalAlpha = 1;
        const cl = cabLabel(slotCab(i));
        ctx.font = '700 220px system-ui, Arial'; ctx.fillText(String(cl), x + P / 2, P / 2 - 10);
        ctx.font = '600 38px ui-monospace, Consolas, monospace'; ctx.fillText('x ' + x + '–' + (x + P - 1), x + P / 2, P - 50);
        ctx.fillText('SLOT ' + (i + 1) + ' → CAB ' + cl, x + P / 2, 44);
      }
      ctx.restore();
    }
  }

  // Full composite: video layer (optional) underneath, strobe flashes on top.
  function drawComposite(ctx, S, labels, cfgV) {
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, L.OUT_W, L.OUT_H);
    if (D.video && D.video.draw(ctx)) {
      if (S.fade < 1) { ctx.fillStyle = 'rgba(0,0,0,' + (1 - S.fade) + ')'; ctx.fillRect(0, 0, L.OUT_W, L.OUT_H); }
    }
    const overlay = cfgV && cfgV.blend === 'add';
    // OVERLAY strength: how much of the strobe colour covers the video (100 = almost hard, lower = more video shows through)
    const os = overlay ? D.util.clamp(((cfgV.overlayStrength == null ? 85 : cfgV.overlayStrength) / 100), 0.2, 1) : 1;
    ctx.globalCompositeOperation = 'source-over'; // normal mixing (NOT additive) so the strobe colour stays pure/saturated over any video
    for (let i = 0; i < L.COUNT; i++) {
      const a = S.alpha[i]; if (a <= 0.002) continue;
      const c = S.cols[i];
      if (overlay) { // OVERLAY BLEND: saturated strobe colour mixed over the video (video dims under the flash instead of washing the colour out)
        ctx.globalAlpha = (a > 1 ? 1 : a) * os;
        ctx.fillStyle = 'rgb(' + (c[0] + 0.5 | 0) + ',' + (c[1] + 0.5 | 0) + ',' + (c[2] + 0.5 | 0) + ')';
      } else { // HARD: strobe fully replaces the video in that cabinet, no blending at all
        const k = a > 1 ? 1 : a; ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgb(' + (c[0] * k + 0.5 | 0) + ',' + (c[1] * k + 0.5 | 0) + ',' + (c[2] * k + 0.5 | 0) + ')';
      }
      ctx.fillRect(cabSlot(i) * P, 0, P, P);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    if (cfgV && cfgV.neon && D.neon) D.neon.draw(ctx, cfgV.neon, performance.now(), D.neon.level(cfgV.neon, S, cfgV.neonCap)); // neon borders on every cabinet edge
    if (labels) drawOutput(ctx, null, true, true);
  }

  let dotPattern = null;
  function getDots() {
    if (dotPattern) return dotPattern;
    const c = document.createElement('canvas'); c.width = c.height = 6;
    const x = c.getContext('2d');
    x.fillStyle = 'rgba(0,0,0,.42)'; x.fillRect(0, 0, 6, 6);
    x.clearRect(1, 1, 4, 4);
    return (dotPattern = c);
  }

  // Wiring path: the processor chain 1 -> 8 drawn over the cabinets (blue line, arrows, numbered slot dots)
  function drawWiringPath(ctx, ox, oy, sc) {
    const off = -sc * 0.1, pts = [];
    for (let s = 0; s < L.COUNT; s++) { const p = L.panels[slotCab(s)]; pts.push([ox + p.x * sc, oy + p.y * sc + off]); }
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(92,200,255,.95)'; ctx.lineWidth = 3; ctx.shadowColor = '#000'; ctx.shadowBlur = 4;
    ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.stroke();
    ctx.fillStyle = '#5cc8ff';
    for (let i = 1; i < pts.length; i++) { // arrow heads show the cable direction
      const a = pts[i - 1], b = pts[i], mx = a[0] + (b[0] - a[0]) * 0.6, my = a[1] + (b[1] - a[1]) * 0.6, an = Math.atan2(b[1] - a[1], b[0] - a[0]), k = 9;
      ctx.save(); ctx.translate(mx, my); ctx.rotate(an); ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(-k * 0.7, k * 0.6); ctx.lineTo(-k * 0.7, -k * 0.6); ctx.closePath(); ctx.fill(); ctx.restore();
    }
    ctx.shadowBlur = 0; ctx.font = '700 ' + Math.max(11, sc * 0.1) + 'px system-ui, Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const wm = D.wireMode, r = Math.max(10, sc * 0.085);
    pts.forEach((q, i) => {
      const pending = wm && i >= wm.next;
      ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, 7); ctx.fillStyle = pending ? '#4a5870' : '#5cc8ff'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = wm && i === wm.next ? '#ffb938' : '#06101a'; ctx.stroke();
      ctx.fillStyle = '#06101a'; ctx.fillText(String(i + 1), q[0], q[1] + 0.5);
    });
    ctx.restore();
  }

  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }

  // Physical wall preview: a rigged LED wall hanging from a truss. Each 500x500 slice of the output is drawn rotated 45° at its cabinet position.
  function drawWall(canvas, outCanvas, panels, opts) {
    opts = opts || {};
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (!cw || !ch) return;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) { canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr); }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, cw, ch);
    const b = L.bounds();
    const TOP = 0.08, BOT = 0.26, pad = 14;                        // room (in cabinet diagonals) for the truss above and the floor below
    const sc = Math.min((cw - pad * 2) / b.w, (ch - pad * 2) / (b.h + TOP + BOT)); // px per diagonal
    const ox = cw / 2 - ((b.x0 + b.x1) / 2) * sc, oy = ch / 2 - ((b.y0 - TOP + b.y1 + BOT) / 2) * sc;
    const side = sc / Math.SQRT2;
    const gap = 3;
    D.render.geo = { ox, oy, sc, cw, ch };
    const X = (u) => ox + u * sc, Y = (v) => oy + v * sc;

    ctx.save();
    // floor line + contact shadow
    const fy = Y(b.y1 + 0.17), fx = X((b.x0 + b.x1) / 2);
    const fg = ctx.createLinearGradient(X(b.x0 - 0.2), 0, X(b.x1 + 0.2), 0); fg.addColorStop(0, 'rgba(120,146,178,0)'); fg.addColorStop(.5, 'rgba(120,146,178,.28)'); fg.addColorStop(1, 'rgba(120,146,178,0)');
    ctx.strokeStyle = fg; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(b.x0 - 0.2), fy); ctx.lineTo(X(b.x1 + 0.2), fy); ctx.stroke();
    ctx.translate(fx, fy); ctx.scale(1, 0.1);
    const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, sc * 0.95); sg.addColorStop(0, 'rgba(0,0,0,.6)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(0, 0, sc * 0.95, 0, 7); ctx.fill();
    ctx.restore();

    // light spill (additive) – the wall glows in whatever colour the cabinet shows
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    L.panels.forEach((p, i) => {
      const c = panels[i]; const m = Math.max(c[0], c[1], c[2]);
      if (m < 8) return;
      const cx = X(p.x), cy = Y(p.y), r = sc * 1.0;
      const g = ctx.createRadialGradient(cx, cy, sc * 0.1, cx, cy, r);
      const a = (m / 255) * 0.42;
      g.addColorStop(0, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')');
      g.addColorStop(1, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0)');
      ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    });
    ctx.restore();

    const pathOn = !!(D.config.get().output.showWiringPath) || !!D.wireMode;
    const dots = ctx.createPattern(getDots(), 'repeat');
    const s = side - gap, rot = (i) => (D.wallmap ? D.wallmap.theta(i) : Math.PI / 4);

    // pass 1: cabinet frames (drawn first so a neighbour's frame never covers another cabinet's screen)
    L.panels.forEach((p, i) => {
      ctx.save(); ctx.translate(X(p.x), Y(p.y)); ctx.rotate(rot(i));
      const fg2 = ctx.createLinearGradient(-s / 2, -s / 2, s / 2, s / 2); fg2.addColorStop(0, '#273448'); fg2.addColorStop(1, '#0e1520');
      ctx.fillStyle = fg2; rr(ctx, -s / 2 - 4, -s / 2 - 4, s + 8, s + 8, 4); ctx.fill();
      ctx.strokeStyle = '#394a65'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#566a8a'; const k = s / 2 + 2;                            // corner screws
      [[-k, -k], [k, -k], [k, k], [-k, k]].forEach((q) => { ctx.beginPath(); ctx.arc(q[0], q[1], 1.3, 0, 7); ctx.fill(); });
      ctx.restore();
    });
    // pass 2: LED faces
    L.panels.forEach((p, i) => {
      const c = panels[i], m = Math.max(c[0], c[1], c[2]);
      ctx.save(); ctx.translate(X(p.x), Y(p.y)); ctx.rotate(rot(i));
      ctx.fillStyle = '#04070b'; ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.drawImage(outCanvas, cabSlot(i) * P, 0, P, P, -s / 2, -s / 2, s, s);  // the tile of the processor slot this cabinet is wired to
      ctx.fillStyle = dots; ctx.fillRect(-s / 2, -s / 2, s, s);                    // LED pixel texture
      if (m > 8) { ctx.shadowColor = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; ctx.shadowBlur = 10; ctx.strokeStyle = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',.85)'; ctx.lineWidth = 1.5; }
      else { ctx.strokeStyle = 'rgba(160,182,212,.16)'; ctx.lineWidth = 1; }
      ctx.strokeRect(-s / 2, -s / 2, s, s);
      ctx.restore();
    });
    // cabinet tags (P number, and the processor slot when the wiring path is hidden)
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const fs = Math.max(10, sc * 0.082); ctx.font = '600 ' + fs + 'px ui-monospace, "Cascadia Mono", Consolas, monospace';
    L.panels.forEach((p, i) => {
      const t = 'P' + cabLabel(i) + (pathOn ? '' : ' · S' + (cabSlot(i) + 1)), tw = ctx.measureText(t).width + fs * 1.1, th2 = fs * 1.6;
      const cx = X(p.x), cy = Y(p.y) + sc * 0.27;
      ctx.fillStyle = 'rgba(6,10,16,.78)'; rr(ctx, cx - tw / 2, cy - th2 / 2, tw, th2, th2 / 2); ctx.fill();
      ctx.strokeStyle = 'rgba(160,182,212,.28)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#e8edf5'; ctx.fillText(t, cx, cy + 0.5);
    });
    ctx.restore();
    if (pathOn) drawWiringPath(ctx, ox, oy, sc);
  }

  // Pattern pad thumbnail: unlit cabinets are outlines, lit ones fill with the live-source accent colour.
  function drawThumb(canvas, thumb, rgb, activeSet, isActive) {
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    const b = L.bounds(), pad = 12;
    const sc = Math.min((w - pad * 2) / b.w, (h - pad * 2) / b.h);
    const ox = w / 2 - ((b.x0 + b.x1) / 2) * sc, oy = h / 2 - ((b.y0 + b.y1) / 2) * sc;
    const s = sc / Math.SQRT2 - 5;
    L.panels.forEach((p, i) => {
      const v = activeSet ? (activeSet.indexOf(i) >= 0 ? 1 : 0.1) : thumb[i];
      ctx.save(); ctx.translate(ox + p.x * sc, oy + p.y * sc); ctx.rotate(Math.PI / 4);
      rr(ctx, -s / 2, -s / 2, s, s, s * 0.14);
      ctx.fillStyle = 'rgba(124,146,178,.08)'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = v > 0.14 ? 'rgba(' + rgb + ',' + (0.35 + 0.65 * v) + ')' : 'rgba(124,146,178,.3)'; ctx.stroke();
      if (v > 0.14) {
        if (isActive && v > 0.85) { ctx.shadowColor = 'rgb(' + rgb + ')'; ctx.shadowBlur = 14; }
        rr(ctx, -s / 2 + 3, -s / 2 + 3, s - 6, s - 6, s * 0.1);
        ctx.fillStyle = 'rgba(' + rgb + ',' + (0.12 + 0.88 * v) + ')'; ctx.fill();
      }
      ctx.restore();
    });
  }

  D.render = { drawOutput, drawComposite, drawWall, drawThumb };
})();
