/* Video layer: up to 5 clips (ideally 4000x500) play underneath the strobe.
   Which clip is on screen is chosen by the ACTIVE control source (audio beats / console pulse / manual) – never by a timer
   and not in pattern order (random, non-repeating by default). */
(function () {
  'use strict';
  const D = window.DLS;
  const MAX = 5; // normal rotating clips; plus 1 special clip and 1 starting promo clip
  const cfg = () => D.config.get().video;
  const ON_KEY = 'dls.video.on';
  const loadOn = () => { try { return JSON.parse(localStorage.getItem(ON_KEY) || '{}') || {}; } catch (e) { return {}; } };
  const makeEl = (url, loop) => { const el = document.createElement('video'); el.muted = true; el.loop = loop; el.playsInline = true; el.preload = 'auto'; el.crossOrigin = 'anonymous'; el.src = url; return el; };
  const V = D.video = {
    slots: [], cur: -1, prev: -1, fadeStart: 0, changes: 0, lastChangeAt: -1e12,
    special: null, sp: false, specialDue: false, dueAt: 0, nextSpecialAt: 0, specialPlays: 0,
    notice: '', intro: null, ip: false, introWanted: false, introDone: false, library: [], on: loadOn(), libError: '',
    /* ---- library = links added on admin.html (bunny.net). The preview page can only switch them ON / OFF. ---- */
    saveOn() { try { localStorage.setItem(ON_KEY, JSON.stringify(V.on)); } catch (e) { /* ignore */ } },
    addSlot(x) {
      const el = makeEl(x.url, true);
      if (cfg().warm) el.play().catch(() => {});
      V.slots.push({ id: x.id, name: x.name, el, w: 0, h: 0, remote: x.url, up: 'done' });
      el.addEventListener('loadedmetadata', () => { const s = V.slots.find((q) => q.el === el); if (s) { s.w = el.videoWidth; s.h = el.videoHeight; D.bus.emit('video-slots'); } });
      el.addEventListener('error', () => { const s = V.slots.find((q) => q.el === el); if (s) { s.error = true; D.bus.emit('video-slots'); } });
      if (V.cur < 0) V.select(V.slots.length - 1);
    },
    apply(x) {
      const want = !!V.on[x.id];
      if (x.kind === 'intro') {
        if (V.ip) return;
        if (want && !V.introDone && !(V.intro && V.intro.id === x.id)) V.setIntroUrl(x);
        else if (!want && V.intro && V.intro.id === x.id) V.clearIntro();
        return;
      }
      if (x.kind === 'special') {
        if (V.sp) return; // a playing special clip is never touched
        if (want && !(V.special && V.special.id === x.id)) V.setSpecialUrl(x);
        else if (!want && V.special && V.special.id === x.id) V.clearSpecial();
        return;
      }
      const i = V.slots.findIndex((q) => q.id === x.id);
      if (want && i < 0) { if (V.slots.length >= MAX) { V.on[x.id] = false; V.notice = 'Max ' + MAX + ' videos ek saath ON ho sakte hain – pehle koi OFF karo.'; } else V.addSlot(x); }
      else if (!want && i >= 0) V.remove(i);
    },
    setLibrary(items) {
      V.library = items; V.notice = '';
      const ids = new Set(items.map((x) => x.id));
      for (let i = V.slots.length - 1; i >= 0; i--) if (!ids.has(V.slots[i].id)) V.remove(i);
      if (V.special && !V.sp && !ids.has(V.special.id)) V.clearSpecial();
      if (V.intro && !V.ip && !ids.has(V.intro.id)) V.clearIntro();
      let n = items.filter((x) => x.kind === 'normal' && V.on[x.id]).length;
      items.forEach((x) => { if (!(x.id in V.on)) V.on[x.id] = x.kind !== 'normal' ? true : n < MAX ? (n++, true) : false; });
      V.saveOn(); items.forEach((x) => V.apply(x));
      D.bus.emit('video-slots');
    },
    toggle(id, on) {
      const x = V.library.find((q) => q.id === id); if (!x) return;
      V.notice = ''; V.on[id] = !!on; V.saveOn(); V.apply(x);
      D.bus.emit('video-slots'); D.bus.emit('video-change');
    },
    load() {
      if (!window.DLSBackend) return Promise.resolve();
      return window.DLSBackend.list().then((items) => { V.libError = ''; V.setLibrary(items); })
        .catch((e) => { V.libError = String(e && e.message || e); D.bus.emit('video-slots'); });
    },
    remove(i) {
      const s = V.slots[i]; if (!s) return;
      s.el.pause(); s.el.removeAttribute('src'); s.el.load();
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
      if (V.sp || V.ip) return false; // special / promo clips are not skippable
      if (V.slots.length < 2) return false;
      // photosensitivity: in Safe mode beat-driven cuts obey the same max rate as flashes
      if (src === 'audio' || src === 'tiger') { const t = performance.now(); if (t - V.lastChangeAt < 1000 / D.engine.effMaxHz()) return false; }
      V.select(V.pick(dir)); return true;
    },
    choose(src, i) { if (!D.engine.accept(src) || V.sp || V.ip) return false; V.select(i); return true; },
    /* ---- special clip: appears every 4-5 min (configurable), plays to the end, cannot be skipped ---- */
    setSpecialUrl(x) {
      V.clearSpecial();
      const el = makeEl(x.url, false);
      const sp = V.special = { id: x.id, name: x.name, el, w: 0, h: 0, remote: x.url, up: 'done' };
      el.addEventListener('loadedmetadata', () => { sp.w = el.videoWidth; sp.h = el.videoHeight; sp.dur = el.duration; D.bus.emit('video-slots'); });
      el.addEventListener('ended', () => V.endSpecial());
      el.addEventListener('error', () => { sp.error = true; V.endSpecial(); D.bus.emit('video-slots'); });
      V.scheduleSpecial(performance.now());
      D.bus.emit('video-slots');
    },
    /* ---- starting promo clip: plays once when the site is switched on (3-15 s), cannot be skipped ---- */
    setIntroUrl(x) {
      V.clearIntro();
      const el = makeEl(x.url, false);
      const ip = V.intro = { id: x.id, name: x.name, el, w: 0, h: 0, remote: x.url, up: 'done' };
      el.addEventListener('loadedmetadata', () => { ip.w = el.videoWidth; ip.h = el.videoHeight; ip.dur = el.duration; D.bus.emit('video-slots'); });
      el.addEventListener('ended', () => V.endIntro());
      el.addEventListener('error', () => { ip.error = true; if (V.ip) V.endIntro(); D.bus.emit('video-slots'); });
      if (V.introWanted) V.startIntro();
      D.bus.emit('video-slots');
    },
    clearIntro() {
      if (V.ip) return;
      if (V.intro) { V.intro.el.pause(); V.intro.el.removeAttribute('src'); V.intro.el.load(); V.intro = null; }
      D.bus.emit('video-slots');
    },
    requestIntro() { V.introWanted = true; V.startIntro(); }, // called when the site is switched on (Continue button)
    startIntro() {
      const ip = V.intro;
      if (!ip || V.ip || V.introDone || ip.error || !cfg().enabled) return false;
      V.ip = true; V.introWanted = false; V.fadeStart = performance.now();
      try { ip.el.currentTime = 0; } catch (e) { /* ignore */ }
      ip.el.play().catch(() => V.endIntro());
      D.bus.emit('video-change'); return true;
    },
    endIntro() {
      if (!V.ip) return;
      V.ip = false; V.introDone = true; V.introWanted = false;
      if (V.intro) V.intro.el.pause();
      V.scheduleSpecial(performance.now());
      if (V.slots.length) { V.prev = -1; V.cur = -1; V.select(V.pick()); }
      D.bus.emit('video-change');
    },
    clearSpecial() {
      if (V.sp) return; // cannot be removed while it plays
      if (V.special) { V.special.el.pause(); V.special.el.removeAttribute('src'); V.special.el.load(); V.special = null; }
      V.specialDue = false; D.bus.emit('video-slots');
    },
    scheduleSpecial(t) {
      const c = cfg(); const lo = Math.max(0.1, c.specialMinMin), hi = Math.max(lo, c.specialMaxMin);
      V.nextSpecialAt = t + (lo + Math.random() * (hi - lo)) * 60000; V.specialDue = false;
    },
    startSpecial() {
      const sp = V.special; if (!sp || V.sp || V.ip || sp.error) return false;
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
      if (V.special && !V.sp && !V.ip && c.enabled && !V.special.error) {
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
      if (!c.enabled || (V.cur < 0 && !V.sp && !V.ip)) return false;
      const t = performance.now();
      const w = D.layout.OUT_W, h = D.layout.OUT_H;
      const paint = (s, a) => { if (s && s.el.readyState >= 2 && !s.error) { ctx.globalAlpha = a; if (D.wallmap && D.wallmap.useWall(c.mapMode, s.el)) D.wallmap.draw(ctx, s.el, w, h); else ctx.drawImage(s.el, 0, 0, w, h); return true; } return false; };
      const a = c.xfadeMs > 0 ? Math.min(1, (t - V.fadeStart) / c.xfadeMs) : 1;
      if (V.ip && V.intro) {
        paint(V.intro, 1); ctx.globalAlpha = 1;
        if (c.level < 100) { ctx.fillStyle = 'rgba(0,0,0,' + (1 - c.level / 100) + ')'; ctx.fillRect(0, 0, w, h); }
        return true;
      }
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
  setInterval(() => { if (!document.hidden) V.load(); }, 30000);
  addEventListener('load', () => V.load());
})();
