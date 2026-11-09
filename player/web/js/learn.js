/* Auto-Sync wizard: learns the DJ-light channels (R, G, B, dimmer, strobe) from live Art-Net data.
   The user just moves the fixture on the console; the channel that rises most is assigned. No channel numbers to type. */
(function (g) {
  'use strict';
  const D = g.DLS;
  const cfg = () => D.config.get();

  const STEPS = [
    { key: 'r', title: 'RED', msg: 'On the console set this DJ light to RED (full). Other colours at 0.', th: 40 },
    { key: 'g', title: 'GREEN', msg: 'Now set the same light to GREEN (full), red at 0.', th: 40 },
    { key: 'b', title: 'BLUE', msg: 'Now set it to BLUE (full), green at 0.', th: 40 },
    { key: 'dim', title: 'DIMMER / INTENSITY (optional)', msg: 'Move the light\'s dimmer / intensity fader up (if it is already up, pull it down and then up). No separate dimmer? Press Skip.', th: 40, opt: true },
    { key: 'strobe', title: 'STROBE (optional)', msg: 'Switch the light\'s STROBE on from the console (strobe attribute / strobe fader). Press Skip to simply follow the light turning on and off (dimmer flash).', th: 15, opt: true }
  ];

  // pure helpers (also used by the self-test)
  const L = {
    STEPS,
    // find the channel that rose most above its running minimum; returns {u, ch (1-based), v} or null
    detect(dmx, mins, exclude, pinU, th) {
      let best = null;
      Object.keys(dmx).forEach((us) => {
        const u = +us; if (pinU != null && u !== pinU) return;
        const d = dmx[us]; const m = mins[us] || (mins[us] = Uint8Array.from(d));
        for (let i = 0; i < 512; i++) {
          if (d[i] < m[i]) m[i] = d[i];
          if (exclude.has(u + ':' + i)) continue;
          const rise = d[i] - m[i];
          if (rise >= th && (!best || rise > best.rise)) best = { u, ch: i + 1, v: d[i], rise };
        }
      });
      return best;
    },
    // learned channels -> config values
    build(a) {
      const chs = ['r', 'g', 'b', 'dim', 'strobe'].filter((k) => a[k]).map((k) => a[k]);
      const start = Math.min.apply(null, chs), end = Math.max.apply(null, chs);
      const roles = new Array(end - start + 1).fill('none');
      ['r', 'g', 'b', 'dim', 'strobe'].forEach((k) => { if (a[k]) roles[a[k] - start] = k; });
      return {
        universe: a.u, startAddress: start, roles: roles.join(','), footprint: roles.length,
        flashSource: a.strobe ? 'strobech' : 'intensity', flashChannel: a.strobe || cfg().tiger.flashChannel, hasDim: !!a.dim
      };
    }
  };
  D.learn = L;
  if (typeof document === 'undefined' || !document.getElementById('learnModal')) return;

  const $ = (s) => document.querySelector(s);
  let idx = 0, assign = {}, mins = {}, timer = null, finished = false, skipped = {};

  function snapshotMins() { mins = {}; Object.keys(D.artnet.dmx).forEach((u) => { mins[u] = Uint8Array.from(D.artnet.dmx[u]); }); }
  function excluded() { const ex = new Set(); STEPS.forEach((s) => { if (assign[s.key]) ex.add(assign.u + ':' + (assign[s.key] - 1)); }); return ex; }
  function render() {
    const st = $('#learnStatus'), A = D.artnet;
    const have = Object.keys(A.dmx).length > 0 && !A.stale;
    if (finished) {
      const rgb = A.wallColour || [0, 0, 0];
      st.className = 'learn-status ok';
      st.innerHTML = '✓ Synced. Now change the light\'s colour on the console – this swatch follows it: <span class="learn-live" style="background:rgb(' + rgb.map(Math.round).join(',') + ')"></span>' + (cfg().tiger.flashSource === 'strobech' ? ' Strobe: the wall strobes whenever the console strobe is on.' : ' Flash: the wall flashes when the light turns on.');
    } else if (!A.connected) { st.className = 'learn-status bad'; st.textContent = 'Bridge not running – start the player with start.bat / start.command (not by opening the html file).'; }
    else if (!have) { st.className = 'learn-status bad'; st.textContent = 'No Art-Net data yet. Check the console\'s Art-Net output + same network (docs/SETUP.md), then keep this window open.'; }
    else { st.className = 'learn-status ok'; st.textContent = 'Art-Net signal OK – listening on universe ' + (assign.u != null ? assign.u : 'any') + '…'; }
    const box = $('#learnStepBox');
    if (finished) box.innerHTML = '<h3>All done ✓</h3><p>Tiger Touch mode is now ON. Colours and strobe follow your DJ light automatically.</p>';
    else { const s = STEPS[idx]; box.innerHTML = '<h3>Step ' + (idx + 1) + '/' + STEPS.length + ' – ' + s.title + '</h3><p>' + s.msg + '</p>'; }
    $('#learnList').innerHTML = STEPS.map((s) => '<span class="li' + (assign[s.key] ? ' done' : skipped[s.key] ? ' skip' : '') + '">' + s.title.replace(' (optional)', '') + (assign[s.key] ? ' = ch ' + assign[s.key] : skipped[s.key] ? ' (skipped)' : '') + '</span>').join('');
    $('#learnSkip').hidden = finished || !STEPS[idx].opt;
    $('#learnDone').hidden = !finished;
  }
  function apply() {
    const r = L.build(assign), C = D.config;
    C.setPath('artnet.universe', r.universe, true);
    C.setPath('fixture.profile', 'custom', true); C.setPath('fixture.customChannels', r.roles, true);
    C.setPath('fixture.startAddress', r.startAddress, true); C.setPath('fixture.count', 1, true); C.setPath('fixture.spacing', 0, true);
    C.setPath('fixture.dimmerScalesColor', r.hasDim, true);
    C.setPath('tiger.colorMode', 'fixture', true); C.setPath('tiger.flashSource', r.flashSource, true);
    C.setPath('tiger.flashChannel', r.flashChannel, true); C.setPath('tiger.gate', true, true);
    C.save(); D.bus.emit('config', 'fixture.profile'); D.bus.emit('config', 'tiger.flashSource');
    document.querySelectorAll('[data-cfg]').forEach((el) => { const v = C.getPath(el.dataset.cfg); if (v == null) return; if (el.type === 'checkbox') el.checked = !!v; else el.value = v; });
    D.engine.setMode('tiger');
    finished = true; render();
  }
  function next() { idx++; snapshotMins(); if (idx >= STEPS.length) { if (!assign.r || !assign.g || !assign.b) { idx = 0; render(); return; } apply(); } else render(); }
  function poll() {
    if (finished) { render(); return; }
    const A = D.artnet; render();
    if (!A.connected || A.stale) return;
    const s = STEPS[idx];
    const hit = L.detect(A.dmx, mins, excluded(), assign.u == null ? null : assign.u, s.th);
    if (hit) { if (assign.u == null) assign.u = hit.u; assign[s.key] = hit.ch; next(); }
  }
  function start() {
    idx = 0; assign = {}; skipped = {}; finished = false; snapshotMins(); render();
    clearInterval(timer); timer = setInterval(poll, 80);
  }
  function open() { $('#learnModal').classList.add('open'); start(); }
  function close() { $('#learnModal').classList.remove('open'); clearInterval(timer); }
  $('#btnLearn').addEventListener('click', open);
  $('#learnClose').addEventListener('click', close); $('#learnDone').addEventListener('click', close);
  $('#learnRestart').addEventListener('click', start);
  $('#learnSkip').addEventListener('click', () => { skipped[STEPS[idx].key] = true; next(); });
})(window);
