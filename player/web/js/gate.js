/* Password gate for admin.html and mapper.html. Page stays hidden until the password is accepted. */
(function () {
  'use strict';
  const hide = document.createElement('style'); hide.id = 'gateHide'; hide.textContent = 'body{visibility:hidden!important}';
  document.head.appendChild(hide);
  function unlock() { const h = document.getElementById('gateHide'); if (h) h.remove(); const g = document.getElementById('gate'); if (g) g.remove(); document.dispatchEvent(new Event('gate-open')); }
  function show() {
    const B = window.DLSBackend;
    const g = document.createElement('div'); g.id = 'gate';
    g.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:#0d0f13;visibility:visible;font:14px system-ui,sans-serif;color:#e6e9ef';
    g.innerHTML = '<form style="background:#161a21;border:1px solid #2b323e;border-radius:12px;padding:26px;width:min(340px,90vw);display:flex;flex-direction:column;gap:12px;text-align:center">'
      + '<div style="font-size:20px;font-weight:800;letter-spacing:1px;color:#f5b72e">DK EDITS VJ PLAYER</div><div style="color:#8b94a5">Enter password</div>'
      + '<input type="password" inputmode="numeric" autocomplete="current-password" placeholder="Password" style="font:inherit;color:inherit;background:#10141a;border:1px solid #2b323e;border-radius:8px;padding:10px;text-align:center">'
      + '<button type="submit" style="font:inherit;font-weight:700;border:0;border-radius:8px;padding:10px;cursor:pointer;background:linear-gradient(180deg,#ffd24d,#f0a500);color:#1a1200">Unlock</button>'
      + '<div id="gateMsg" style="min-height:18px;color:#ff5d6c;font-size:12px"></div></form>';
    document.body.appendChild(g);
    const f = g.querySelector('form'), i = g.querySelector('input'), m = g.querySelector('#gateMsg'); i.focus();
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); m.textContent = ''; f.querySelector('button').disabled = true;
      try { await B.login(i.value); unlock(); } catch (err) { m.textContent = err.message || 'Wrong password'; i.select(); }
      f.querySelector('button').disabled = false;
    });
  }
  async function start() {
    try { if (await window.DLSBackend.isLoggedIn()) return unlock(); } catch (e) { /* ignore */ }
    show();
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
