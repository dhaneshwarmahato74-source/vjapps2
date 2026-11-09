/* Video layer: up to 5 clips (ideally 4000x500) play underneath the strobe.
   Which clip is on screen is chosen by the ACTIVE control source (audio beats / console pulse / manual) – never by a timer
   and not in pattern order (random, non-repeating by default). */
(function () {
  'use strict';
  const D = window.DLS;
  const MAX = 4; // normal rotating clips; plus 1 special clip
  const cfg = () => D.config.get().video;
  const V = D.video = {
    slots: [], cur: -1, prev: -1, fadeStart: 0, changes: 0, lastChangeAt: -1e12,
    special: null, sp: false, specialDue: false, dueAt: 0, nextSpecialAt: 0, specialPlays: 0,
    notice: '',
    add(files) {
      const skipped = [], bad = []; V.notice = '';
      for (const f of files) {
        if (!/^video\//.test(f.type) && !/\.(mp4|webm|mov|m4v|mkv)$/i.test(f.name)) { bad.push(f.name); continue; }
        if (V.slots.length >= MAX) { skipped.push(f.name); continue; }
        const el = document.createElement('video');
        el.muted = true; el.loop = true; el.playsInline = true; el.preload = 'auto'; el.src = URL.createObjectURL(f);
        if (cfg().warm) el.play().catch(() => {}); // keep every clip running so a cut is instant
        const slot = { name: f.name, el, w: 0, h: 0 }; V.slots.push(slot); if (D.upload) D.upload(slot, f);
        el.addEventListener('loadedmetadata', () => { const s = V.slots.find((x) => x.el === el); if (s) { s.w = el.videoWidth; s.h = el.videoHeight; D.bus.emit('video-slots'); } });
        el.addEventListener('error', () => { const s = V.slots.find((x) => x.el === el); if (s) { s.error = true; D.bus.emit('video-slots'); } });
      }
      if (V.cur < 0 && V.slots.length) V.select(0);
      if (skipped.length) V.notice += 'Only ' + MAX + ' clips fit – not loaded: ' + skipped.join(', ') + '. ';
      if (bad.length) V.notice += 'Not a video file: ' + bad.join(', ') + '. ';
      D.bus.emit('video-slots');
    },
    retryUpload(i) { const s = V.slots[i]; if (s && s.file && D.upload) D.upload(s, s.file); },
    remove(i) {
      const s = V.slots[i]; if (!s) return;
      if (D.unupload) D.unupload(s);
      s.el.pause(); URL.revokeObjectURL(s.el.src); s.el.removeAttribute('src'); s.el.load();
      V.slots.splice(i, 1);
      V.prev = -1; V.cur = V.slots.length ? Math.min(V.cur >= i ? Math.max(0, V.cur - (V.cur === i ? 0 : 1)) : V.cur, V.slots.length - 1) : -1;
      if (V.cur >= 0) V.slots[V.cur].el.play().catch(() => {});
      D.bus.emit('video-slots'); D.bus.emit('video-change');
    },
    select(i) {
      const s = V.slots[i]; if (!s || i === V.cur) return;
      V.prev = V.cur; V.cur = i; V.fadeStart = V.lastChangeAt = performance.now(); V.changes++;
      s.el.play().catch(() => {});
      if (cfg().warm) V.slots.forEach((x) => { if (x.el.paused) x.el.play().catch(() => {}); });
      D.bus.emit('video-change');
    },
    pick(dir) {
      const n = V.slots.length;
      if (n < 2) return V.cur;
      if (dir) return (V.cur + dir + n) % n;
      if (cfg().order === 'sequence') return (V.cur + 1) % n;
      let j; do { j = Math.floor(Math.random() * n); } while (j === V.cur); // random, never the same clip twice in a row
      return j;
    },
    /* source-gated change (audio / tiger / manual) */
    change(src, dir) {
      if (!D.engine.accept(src)) return false;
      if (V.sp) return false; // special clip is not skippable
      if (V.slots.length < 2) return false;
      // photosensitivity: in Safe mode beat-driven cuts obey the same max rate as flashes
      if (src === 'audio' || src === 'tiger') { const t = performance.now(); if (t - V.lastChangeAt < 1000 / D.engine.effMaxHz()) return false; }
      V.select(V.pick(dir)); return true;
    },
    choose(src, i) { if (!D.engine.accept(src) || V.sp) return false; V.select(i); return true; },
    /* ---- special clip: appears every 4-5 min (configurable), plays to the end, cannot be skipped ---- */
    setSpecial(file) {
      V.clearSpecial();
      const el = document.createElement('video');
      el.muted = true; el.loop = false; el.playsInline = true; el.preload = 'auto'; el.src = URL.createObjectURL(file);
      const sp = V.special = { name: file.name, el, w: 0, h: 0 }; if (D.upload) D.upload(sp, file);
      el.addEventListener('loadedmetadata', () => { sp.w = el.videoWidth; sp.h = el.videoHeight; sp.dur = el.duration; D.bus.emit('video-slots'); });
      el.addEventListener('ended', () => V.endSpecial());
      el.addEventListener('error', () => { sp.error = true; V.endSpecial(); D.bus.emit('video-slots'); });
      V.scheduleSpecial(performance.now());
      D.bus.emit('video-slots');
    },
    clearSpecial() {
      if (V.sp) return; // cannot be removed while it plays
      if (V.special) { if (D.unupload) D.unupload(V.special); V.special.el.pause(); URL.revokeObjectURL(V.special.el.src); V.special = null; }
      V.specialDue = false; D.bus.emit('video-slots');
    },
    scheduleSpecial(t) {
      const c = cfg(); const lo = Math.max(0.1, c.specialMinMin), hi = Math.max(lo, c.specialMaxMin);
      V.nextSpecialAt = t + (lo + Math.random() * (hi - lo)) * 60000; V.specialDue = false;
    },
    startSpecial() {
      const sp = V.special; if (!sp || V.sp || sp.error) return false;
      V.sp = true; V.specialDue = false; V.fadeStart = performance.now(); V.specialPlays++;
      try { sp.el.currentTime = 0; } catch (e) { /* ignore */ }
      sp.el.play().catch(() => V.endSpecial());
      D.bus.emit('video-change'); return true;
    },
    endSpecial() {
      if (!V.sp) return;
      V.sp = false;
      if (V.special) V.special.el.pause();
      V.scheduleSpecial(performance.now());
      if (V.slots.length) { V.prev = -1; V.cur = -1; V.select(V.pick()); }
      D.bus.emit('video-change');
    },
    onBeat() { if (V.specialDue && !V.sp) V.startSpecial(); }, // in Audio mode the special clip enters on a beat
    specialStatus() {
      const t = performance.now(), sp = V.special;
      if (!sp) return '';
      if (V.sp) { const left = Math.max(0, (sp.el.duration || 0) - sp.el.currentTime); return 'SPECIAL PLAYING – locked, ' + Math.ceil(left) + ' s left'; }
      const m = Math.max(0, V.nextSpecialAt - t) / 1000;
      return 'Next special in ' + Math.floor(m / 60) + ':' + String(Math.floor(m % 60)).padStart(2, '0');
    },
    update(t) {
      const c = cfg();
      if (V.special && !V.sp && c.enabled && !V.special.error) {
        if (!V.specialDue && t >= V.nextSpecialAt) { V.specialDue = true; V.dueAt = t; }
        if (V.specialDue) {
          // Audio mode: wait for the next beat (fallback after 8 s of silence). Other modes: start right away.
          if (D.state.mode !== 'audio' || t - V.dueAt > 8000) V.startSpecial();
        }
      }
      if (!c.warm && V.sp && V.cur >= 0 && t - V.fadeStart > c.xfadeMs + 50) { const cs = V.slots[V.cur]; if (cs && !cs.el.paused) cs.el.pause(); }
      if (V.prev >= 0 && t - V.fadeStart >= c.xfadeMs + 50) { if (!c.warm) { const p = V.slots[V.prev]; if (p) p.el.pause(); } V.prev = -1; }
      if (!c.warm) V.slots.forEach((x, i) => { if (i !== V.cur && i !== V.prev && !x.el.paused) x.el.pause(); });
      else if (c.enabled) V.slots.forEach((x) => { if (x.el.paused && !x.error && x.el.readyState >= 2) x.el.play().catch(() => {}); });
    },
    draw(ctx) {
      const c = cfg();
      if (!c.enabled || (V.cur < 0 && !V.sp)) return false;
      const t = performance.now();
      const w = D.layout.OUT_W, h = D.layout.OUT_H;
      const paint = (s, a) => { if (s && s.el.readyState >= 2 && !s.error) { ctx.globalAlpha = a; if (D.wallmap && D.wallmap.useWall(c.mapMode, s.el)) D.wallmap.draw(ctx, s.el, w, h); else ctx.drawImage(s.el, 0, 0, w, h); return true; } return false; };
      const a = c.xfadeMs > 0 ? Math.min(1, (t - V.fadeStart) / c.xfadeMs) : 1;
      if (V.sp && V.special) {
        if (a < 1 && V.cur >= 0) paint(V.slots[V.cur], 1);
        paint(V.special, a < 1 ? a : 1); ctx.globalAlpha = 1;
        if (c.level < 100) { ctx.fillStyle = 'rgba(0,0,0,' + (1 - c.level / 100) + ')'; ctx.fillRect(0, 0, w, h); }
        return true;
      }
      if (V.prev >= 0 && a < 1) paint(V.slots[V.prev], 1);
      const ok = paint(V.slots[V.cur], V.prev >= 0 && a < 1 ? a : 1);
      ctx.globalAlpha = 1;
      if (c.level < 100) { ctx.fillStyle = 'rgba(0,0,0,' + (1 - c.level / 100) + ')'; ctx.fillRect(0, 0, w, h); }
      return ok;
    }
  };
})();
