/* Inspector tabs (Source / Video / Look / Neon / Output / Safety). Pure UI – no player state is touched. */
(function () {
  'use strict';
  const tabs = Array.from(document.querySelectorAll('.tab'));
  const panes = Array.from(document.querySelectorAll('.pane-body'));
  if (!tabs.length) return;
  const KEY = 'dk.inspector.tab';

  function show(id, focus) {
    if (!panes.some((p) => p.dataset.pane === id)) id = 'source';
    tabs.forEach((t) => { const on = t.dataset.tab === id; t.classList.toggle('on', on); t.setAttribute('aria-selected', on ? 'true' : 'false'); t.tabIndex = on ? 0 : -1; if (on && focus) t.focus(); });
    panes.forEach((p) => { p.hidden = p.dataset.pane !== id; });
    const host = document.querySelector('.panes'); if (host) host.scrollTop = 0;
    try { localStorage.setItem(KEY, id); } catch (e) { /* storage may be unavailable */ }
  }

  tabs.forEach((t, i) => {
    t.addEventListener('click', () => show(t.dataset.tab));
    t.addEventListener('keydown', (e) => {          // arrow keys move between tabs (only while a tab has focus)
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault(); e.stopPropagation();
      show(tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length].dataset.tab, true);
    });
  });

  // picking a control source brings its settings forward; status chips jump to the matching tab
  document.querySelectorAll('.mode').forEach((b) => b.addEventListener('click', () => show('source')));
  const jump = (id, tab) => { const el = document.getElementById(id); if (el) el.addEventListener('click', () => show(tab)); };
  jump('chipSafe', 'safety'); jump('chipOut', 'output');

  let start = 'source';
  try { start = localStorage.getItem(KEY) || 'source'; } catch (e) { /* ignore */ }
  show(start);
})();
