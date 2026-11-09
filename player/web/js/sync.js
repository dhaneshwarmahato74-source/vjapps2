/* Live sync to output pages that cannot read the controller canvas directly (other browser, other PC, lost opener).
   The controller sends the lightweight frame STATE over the bridge WebSocket; the output page renders it itself
   (clips are uploaded once to the bridge and played from there). */
(function () {
  'use strict';
  const D = window.DLS;
  let last = 0, n = 0, calSent = '';
  D.sync = {
    seq: 0,
    outputs() { const b = D.artnet.bridge; return b && b.outputs || 0; },
    directAlive() { return Date.now() - (D.outputSeen || 0) < 1500; },
    send(t) {
      const A = D.artnet;
      if (!A.connected || !A.ws || A.ws.readyState !== 1 || !D.sync.outputs()) return;
      if (t - last < 15) return; last = t;
      const S = D.state, V = D.video, c = D.config.get();
      const url = (s) => (s && s.remote) || '';
      const cur = V.slots[V.cur], prev = V.slots[V.prev];
      const msg = {
        t: 'f', n: ++n,
        c: [].concat.apply([], S.cols.map((x) => [x[0] | 0, x[1] | 0, x[2] | 0])),
        a: S.alpha.map((x) => Math.round(x * 100) / 100),
        fade: Math.round(S.fade * 100) / 100, nz: Object.assign({}, c.neon, { cur: D.neon ? D.neon.state.cur : 'electric', lv: D.neon ? D.neon.audioLevel() : -1 }), nc: c.safety.safe ? c.safety.maxBrightness : 100, lb: !!c.output.showLabels, fit: c.output.fit,
        v: { en: !!c.video.enabled, lvl: c.video.level, bl: c.video.blend, os: c.video.overlayStrength, xf: c.video.xfadeMs, w: !!c.video.warm, map: c.video.mapMode, all: V.slots.map(url), cur: url(cur), prev: V.prev >= 0 ? url(prev) : '', fs: Math.round(t - V.fadeStart), sp: !!V.sp, spU: url(V.special), spN: V.specialPlays }
      };
      const wm = D.wallmap; if (wm && (wm.json() !== calSent || n % 120 === 0)) { calSent = wm.json(); msg.cal = wm.get(); }
      try { D.artnet.ws.send(JSON.stringify(msg)); } catch (e) { /* ignore */ }
    },
    hello() { /* controller does not announce itself */ }
  };
  /* postMessage bitmap transport: works for ANY origin combination (even when index.html was opened as a plain file://,
     where the browser blocks direct access between windows). Sent only while the output page says direct mirroring is not working. */
  D.pmNeed = true;
  let busy = false, lastPm = 0;
  D.pm = {
    send(t) {
      const w = D.outWin;
      if (!w || w.closed || !D.pmNeed || busy || t - lastPm < 30) return;
      const strip = document.getElementById('strip'); if (!strip) return;
      lastPm = t; busy = true;
      createImageBitmap(strip).then((b) => {
        try { w.postMessage({ t: 'bmp', b, fit: D.config.get().output.fit }, '*', [b]); } catch (e) { try { b.close(); } catch (x) { /* ignore */ } }
        busy = false;
      }).catch(() => { busy = false; });
    }
  };
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m && m.t === 'seen' && D.outWin && e.source === D.outWin) { D.outputSeen = Date.now(); D.outputMode = m.mode; D.pmNeed = !!m.need; }
  });

  // upload a clip to the bridge so output pages can stream it (status shown in the clip list, auto-retry, manual retry)
  D.upload = function (slot, file, attempt) {
    attempt = attempt || 1;
    slot.file = file; slot.up = 'uploading'; slot.uploadError = false; delete slot.upMsg;
    D.bus.emit('video-slots');
    if (!D.config.isServerMode()) { slot.up = 'local'; D.bus.emit('video-slots'); return; } // opened without the bridge: preview only
    fetch('/api/media?name=' + encodeURIComponent(file.name), { method: 'POST', body: file })
      .then((r) => r.json().catch(() => ({})).then((j) => { if (!r.ok || !j.url) throw new Error(j.error || ('HTTP ' + r.status)); return j; }))
      .then((j) => { slot.remote = j.url; slot.up = 'done'; D.bus.emit('video-slots'); })
      .catch((e) => {
        if (attempt < 3) return setTimeout(() => D.upload(slot, file, attempt + 1), 800 * attempt);
        slot.up = 'error'; slot.uploadError = true; slot.upMsg = String(e && e.message || e); D.bus.emit('video-slots');
      });
  };
  D.unupload = function (slot) {
    if (!slot || !slot.remote || !D.config.isServerMode()) return;
    fetch('/api/media/' + encodeURIComponent(slot.remote.split('/').pop()), { method: 'DELETE' }).catch(() => {});
  };
})();
