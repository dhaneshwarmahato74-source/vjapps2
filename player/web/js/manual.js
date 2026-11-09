/* Manual keyboard mode. Pattern/flash/colour keys only act while mode === 'manual'. */
(function () {
  'use strict';
  const D = window.DLS;
  const E = () => D.engine;
  const PATTERN_KEYS = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'KeyA', 'KeyS', 'KeyD', 'KeyG', 'KeyH', 'KeyJ'];
  const GROUP_KEYS = { KeyZ: 0, KeyX: 1, KeyC: 2, KeyV: 3 };
  const held = new Map(); // code -> panel list

  const M = D.manual = {
    colourIdx: D.COLOURS.length - 1,
    setColour(rgb) { D.config.get().manual.colour = rgb.slice(); D.config.save(); D.state.colour.manual = rgb.slice(); D.bus.emit('manual-colour'); },
    cycleColour(dir) { // skips colours that are switched off
      const n = D.COLOURS.length;
      for (let k = 0; k < n; k++) {
        M.colourIdx = (M.colourIdx + dir + n) % n;
        if (D.palette.isOn(D.COLOURS[M.colourIdx].name)) break;
      }
      D.config.get().manual.hardWhite = false;
      M.setColour(D.COLOURS[M.colourIdx].rgb);
    },
    toggleWhite() { const m = D.config.get().manual; m.hardWhite = !m.hardWhite; D.config.save(); D.bus.emit('manual-colour'); },
    trigger() { E().trigger('manual', { gate: false }); },
    holdGroup(g, on) { E().holdPanels('manual', D.layout.groups[g].panels, on); D.bus.emit('hold'); },
    holdPanel(i, on) { E().holdPanels('manual', [i], on); D.bus.emit('hold'); }
  };

  function typing(e) { const t = e.target; return t && (t.tagName === 'INPUT' && !/^(range|checkbox|radio|button|color)$/.test(t.type) || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'); }
  function modal() { return document.querySelector('.modal.open'); }

  window.addEventListener('keydown', (e) => {
    if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const code = e.code;
    if (code === 'Escape') { if (modal()) return; E().setBlackout(!D.state.blackout); e.preventDefault(); return; }
    if (modal()) return;
    // mode switching: Shift+1/2/3
    if (e.shiftKey && /^Digit[123]$/.test(code)) { E().setMode(['tiger', 'audio', 'manual'][+code[5] - 1]); e.preventDefault(); return; }
    if (code === 'KeyB') { E().setBlackout(!D.state.blackout); e.preventDefault(); return; }
    if (D.state.mode !== 'manual') return;   // all keys below are Manual-mode controls
    if (e.repeat && code !== 'ArrowUp' && code !== 'ArrowDown') { if (/^(Space|KeyF|Digit|KeyZ|KeyX|KeyC|KeyV)/.test(code)) e.preventDefault(); return; }
    let handled = true;
    const pi = PATTERN_KEYS.indexOf(code);
    if (pi >= 0) E().selectPattern('manual', pi);
    else if (code === 'Space') M.trigger();
    else if (code === 'KeyF') { E().setStrobeHeld(true); D.bus.emit('hold'); }
    else if (code === 'ArrowRight' || code === 'KeyN') E().advancePattern('manual', 1);
    else if (code === 'ArrowLeft') E().advancePattern('manual', -1);
    else if (code === 'ArrowUp' || code === 'ArrowDown') {
      const o = D.config.get().output; o.brightness = D.util.clamp(o.brightness + (code === 'ArrowUp' ? 5 : -5), 0, 100); D.config.save(); D.bus.emit('config', 'output.brightness');
    }
    else if (code === 'BracketRight' || code === 'BracketLeft') {
      const o = D.config.get().output; const mx = E().effMaxHz();
      o.speedHz = D.util.clamp(+(o.speedHz + (code === 'BracketRight' ? 0.5 : -0.5)).toFixed(1), 0.5, mx); D.config.save(); D.bus.emit('config', 'output.speedHz');
    }
    else if (code === 'Period') D.video.change('manual', 1);
    else if (code === 'Comma') D.video.change('manual', -1);
    else if (code === 'KeyK') M.cycleColour(e.shiftKey ? -1 : 1);
    else if (code === 'KeyM') M.toggleWhite();
    else if (/^Digit[1-8]$/.test(code) && !e.shiftKey) { const i = +code[5] - 1; held.set(code, [i]); M.holdPanel(i, true); }
    else if (code in GROUP_KEYS) { const g = GROUP_KEYS[code]; held.set(code, D.layout.groups[g].panels); M.holdGroup(g, true); }
    else handled = false;
    if (handled) { e.preventDefault(); if (document.activeElement && document.activeElement.tagName === 'BUTTON') document.activeElement.blur(); }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'KeyF') { E().setStrobeHeld(false); D.bus.emit('hold'); }
    if (held.has(e.code)) { E().holdPanels('manual', held.get(e.code), false); held.delete(e.code); D.bus.emit('hold'); }
  });
  window.addEventListener('blur', () => { E().setStrobeHeld(false); held.forEach((l) => E().holdPanels('manual', l, false)); held.clear(); });
})();
