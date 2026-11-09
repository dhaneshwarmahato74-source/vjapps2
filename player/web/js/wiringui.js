/* Wiring controls on the Physical wall preview card (processor slot -> cabinet). Shared with mapper.html. */
(function () {
  'use strict';
  const D = window.DLS, W = D && D.wallmap;
  const host = document.getElementById('wiring'); if (!host || !W) return;
  const state = document.getElementById('wireState');
  function build() {
    const cal = W.get(); host.innerHTML = '';
    for (let s = 0; s < 8; s++) {
      const d = document.createElement('label'); d.className = 'wslot';
      d.innerHTML = '<span>Slot ' + (s + 1) + '</span><select>' + cal.cabs.map((c) => '<option value="' + c.label + '"' + (c.label === cal.wiring[s] ? ' selected' : '') + '>Cab ' + c.label + '</option>').join('') + '</select>';
      d.querySelector('select').addEventListener('change', (e) => {
        const v = +e.target.value;
        W.update((n) => { const t = n.wiring.indexOf(v); if (t >= 0 && t !== s) n.wiring[t] = n.wiring[s]; n.wiring[s] = v; }); // swap so every cabinet stays used once
      });
      host.appendChild(d);
    }
    const ok = W.wiringOk();
    state.innerHTML = ok ? '<span class="wire-ok">· valid</span>' : '<span class="wire-bad">· invalid (duplicate/missing cabinet) – identity order used</span>';
  }
  document.querySelectorAll('#wirePresets [data-w]').forEach((b) => b.addEventListener('click', () => {
    const arr = b.dataset.w.split(',').map(Number); W.update((n) => { n.wiring = arr; });
  }));
  D.bus.on('wiring', build); build();

  /* Wire by clicking: click the cabinets on the physical wall preview in cable order (slot 1, 2, … 8). Esc cancels. */
  const btn = document.getElementById('btnWireClick'), lbl = btn.querySelector('.lbl'), msg = document.getElementById('wireClickMsg'), wall = document.getElementById('wall');
  function stop() { D.wireMode = null; lbl.textContent = 'Wire by clicking'; btn.classList.remove('on'); wall.style.cursor = ''; msg.hidden = true; }
  function say() { const m = D.wireMode; msg.hidden = false; msg.innerHTML = '<b>Click the cabinet cabled to slot ' + (m.next + 1) + '</b> (' + m.next + '/8 done) · Esc = stop'; }
  btn.addEventListener('click', () => {
    if (D.wireMode) { stop(); return; }
    D.wireMode = { next: 0, used: [] }; lbl.textContent = 'Stop wiring'; btn.classList.add('on'); wall.style.cursor = 'crosshair'; say();
  });
  wall.addEventListener('click', (e) => {
    const m = D.wireMode, g = D.render.geo; if (!m || !g) return;
    const r = wall.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = -1, bd = 1e9;
    D.layout.panels.forEach((p, ci) => { const d = Math.hypot(x - (g.ox + p.x * g.sc), y - (g.oy + p.y * g.sc)); if (d < bd) { bd = d; best = ci; } });
    if (best < 0 || bd > g.sc * 0.62 || m.used.indexOf(best) >= 0) return;
    const label = W.get().cabs[best].label, slot = m.next;
    W.update((n) => { const t = n.wiring.indexOf(label); if (t >= 0 && t !== slot) n.wiring[t] = n.wiring[slot]; n.wiring[slot] = label; });
    m.used.push(best); m.next++;
    if (m.next >= 8) { stop(); msg.hidden = false; msg.innerHTML = '<span class="wire-ok">Wiring set: slot 1 → 8 follow the order you clicked.</span>'; } else say();
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && D.wireMode) { stop(); e.stopPropagation(); } }, true);
})();
