/* UI wiring + main loop */
(function () {
  'use strict';
  const D = window.DLS;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const cfg = () => D.config.get();
  const S = D.state, E = D.engine, A = D.artnet, AU = D.audio, M = D.manual, L = D.layout;
  const MODE_NAMES = { tiger: 'Tiger Touch', audio: 'Audio beat', manual: 'Manual keyboard' };
  const MODE_RGB = { tiger: '90,169,255', audio: '63,217,164', manual: '255,185,56' };   // follows the accent colour of the live control source

  const wall = $('#wall'), strip = $('#strip'), stripCtx = strip.getContext('2d');
  let outWin = null;

  /* ---------------- generic config binding ---------------- */
  function parse(el, v) {
    const t = el.dataset.type || (el.type === 'checkbox' ? 'bool' : (el.type === 'range' || el.type === 'number') ? 'float' : 'str');
    if (t === 'bool') return !!el.checked;
    if (t === 'int') return parseInt(v, 10) || 0;
    if (t === 'float') return parseFloat(v) || 0;
    return v;
  }
  function showOut(el) {
    const o = el.parentElement && el.parentElement.querySelector('output');
    if (o && el.type === 'range') o.textContent = (+el.value) + (el.dataset.unit || '');
  }
  function refreshControls() {
    $$('[data-cfg]').forEach((el) => {
      const v = D.config.getPath(el.dataset.cfg);
      if (v === undefined || v === null) return;
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
      showOut(el);
    });
  }
  function bindControls() {
    $$('[data-cfg]').forEach((el) => {
      const h = () => {
        const path = el.dataset.cfg;
        if (path === 'safety.safe' && !el.checked) {
          if (!confirm('Turn OFF safe mode?\n\nThis allows flash rates up to 12 per second and full brightness. Rapid flashing can trigger seizures in photosensitive people. Only continue if your venue/audience risk assessment allows it.')) { el.checked = true; return; }
        }
        D.config.setPath(path, parse(el, el.value));
        showOut(el);
      };
      el.addEventListener('input', h);
      el.addEventListener('change', h);
    });
  }
  function applySafetyLimits() {
    const s = cfg().safety, o = cfg().output;
    const mh = s.safe ? 3 : 12;
    $('#maxHzRange').max = mh; if (s.maxHz > mh) s.maxHz = mh;
    $('#maxBrRange').max = s.safe ? 70 : 100; if (s.maxBrightness > (s.safe ? 70 : 100)) s.maxBrightness = s.safe ? 70 : 100;
    $('#speedRange').max = E.effMaxHz(); if (o.speedHz > E.effMaxHz()) o.speedHz = E.effMaxHz();
    refreshControls();
  }

  /* ---------------- static UI builders ---------------- */
  function buildPatterns() {
    const box = $('#patterns'); box.innerHTML = '';
    D.patterns.list.forEach((p, i) => {
      const b = document.createElement('button'); b.className = 'pat'; b.dataset.i = i; b.title = p.name + ' (key ' + p.key + ')';
      b.innerHTML = '<span class="thumb"><canvas width="176" height="192"></canvas></span><kbd>' + p.key + '</kbd><span class="meta"><span class="n">' + String(i + 1).padStart(2, '0') + '</span><span class="t">' + p.name + '</span></span>';
      b.addEventListener('click', () => E.uiSelectPattern(i));
      box.appendChild(b);
    });
    drawThumbs();
  }
  function drawThumbs(activeSet) {
    $$('.pat').forEach((b, i) => {
      const act = i === S.patternIdx;
      D.render.drawThumb($('canvas', b), D.patterns.list[i].thumb, act ? (MODE_RGB[S.mode] || MODE_RGB.manual) : '124,146,178', act ? activeSet : null, act);
      b.classList.toggle('active', act);
    });
    $('#patName').textContent = (S.patternIdx + 1) + ' · ' + D.patterns.list[S.patternIdx].name;
  }
  function buildMisc() {
    $('#ranges').innerHTML = Array.from({ length: 8 }, (_, i) => '<div><b>P' + (i + 1) + '</b>' + (i * 500) + '–' + (i * 500 + 499) + '</div>').join('');
    // test buttons
    const tb = $('#testBtns');
    for (let i = 0; i < 8; i++) { const b = document.createElement('button'); b.className = 'btn sm toggle'; b.textContent = 'P' + (i + 1); b.dataset.i = i; b.addEventListener('click', () => E.testPanel(i, !S.test.panels.has(i))); tb.appendChild(b); }
    const all = document.createElement('button'); all.className = 'btn sm toggle'; all.textContent = 'All'; all.id = 'testAll'; all.addEventListener('click', () => E.testAll(!S.test.all)); tb.appendChild(all);
    const clr = document.createElement('button'); clr.className = 'btn sm'; clr.textContent = 'Clear'; clr.addEventListener('click', () => E.clearTests()); tb.appendChild(clr);
    // manual group / panel hold buttons
    const hold = (btn, on, off) => {
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); btn.setPointerCapture(e.pointerId); on(); btn.classList.add('down'); });
      const up = () => { off(); btn.classList.remove('down'); };
      btn.addEventListener('pointerup', up); btn.addEventListener('pointercancel', up); btn.addEventListener('lostpointercapture', up);
    };
    L.groups.forEach((g, gi) => { const b = document.createElement('button'); b.className = 'btn'; b.innerHTML = g.name + ' <kbd>' + g.key + '</kbd>'; hold(b, () => M.holdGroup(gi, true), () => M.holdGroup(gi, false)); $('#groupBtns').appendChild(b); });
    for (let i = 0; i < 8; i++) { const b = document.createElement('button'); b.className = 'btn'; b.innerHTML = 'P' + (i + 1); hold(b, () => M.holdPanel(i, true), () => M.holdPanel(i, false)); $('#panelBtns').appendChild(b); }
    hold($('#btnStrobe'), () => E.setStrobeHeld(true), () => E.setStrobeHeld(false));
    $('#btnTrigger').addEventListener('click', () => M.trigger());
    $('#btnWhite').addEventListener('click', () => M.toggleWhite());
    D.COLOURS.forEach((c, i) => {
      const b = document.createElement('button'); b.className = 'sw'; b.title = c.name; b.style.background = 'rgb(' + c.rgb.join(',') + ')';
      b.addEventListener('click', () => { M.colourIdx = i; cfg().manual.hardWhite = false; M.setColour(c.rgb); });
      $('#swatches').appendChild(b);
    });
    // Strobe colour ON/OFF chips
    const chips = {};
    D.COLOURS.forEach((c) => {
      const b = document.createElement('button'); b.className = 'colchip'; b.type = 'button';
      b.innerHTML = '<i style="background:rgb(' + c.rgb.join(',') + ')"></i>' + c.name;
      b.addEventListener('click', () => D.palette.set(c.name, !D.palette.isOn(c.name)));
      $('#colChips').appendChild(b); chips[c.name] = b;
    });
    $('#colAllOn').addEventListener('click', () => D.palette.setAll(true));
    $('#colWhiteOnly').addEventListener('click', () => D.palette.setAll(false));
    const swBtns = $('#swatches').children;
    const refreshCols = () => {
      D.COLOURS.forEach((c, i) => { const on = D.palette.isOn(c.name); chips[c.name].classList.toggle('on', on); chips[c.name].classList.toggle('off', !on); chips[c.name].setAttribute('aria-pressed', on); swBtns[i].classList.toggle('off', !on); });
    };
    D.bus.on('colours', refreshCols); refreshCols();
    $('#colourPicker').addEventListener('input', (e) => { const h = e.target.value; cfg().manual.hardWhite = false; M.setColour([1, 3, 5].map((k) => parseInt(h.substr(k, 2), 16))); });
  }

  /* ---------------- modes ---------------- */
  function renderMode() {
    $$('.mode').forEach((b) => { const on = b.dataset.mode === S.mode; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
    ['tiger', 'audio', 'manual'].forEach((m) => { $('#body-' + m).hidden = m !== S.mode; });
    document.body.dataset.mode = S.mode;
    $('#chipMode').lastChild.textContent = ' ' + MODE_NAMES[S.mode];
    $('#chipMode').className = 'chip on';
    $('#patHint').textContent = S.mode === 'manual' ? 'Click or use keys · ← → to step'
      : S.mode === 'tiger' ? 'Console pattern channel / flash count advances' : 'Advances every N beats; click to lock a start pattern';
    updateAudioUi();
  }
  $$('.mode').forEach((b) => b.addEventListener('click', () => E.setMode(b.dataset.mode)));
  D.bus.on('mode', () => { renderMode(); drawThumbs(); });
  D.bus.on('pattern', () => drawThumbs());
  D.bus.on('flash', (set) => { drawThumbs(set); clearTimeout(flashT); flashT = setTimeout(() => drawThumbs(), 120); });
  let flashT;

  /* ---------------- audio UI ---------------- */
  async function fillDevices() {
    const sel = $('#audioDevice'); const cur = cfg().audio.deviceId;
    try {
      const list = await AU.listDevices();
      sel.innerHTML = '<option value="">Default input</option>' + list.map((d) => '<option value="' + d.deviceId + '">' + (d.label || 'Input ' + d.deviceId.slice(0, 6)) + '</option>').join('');
      sel.value = cur || '';
    } catch (e) { /* ignore */ }
  }
  function updateAudioUi() {
    const file = cfg().audio.source === 'file';
    $('#devField').hidden = file; $('#fileRow').hidden = !file;
    $('#btnAudioStart .lbl').textContent = file ? 'Play file' : 'Start listening';
  }
  D.bus.on('config', (p) => { if (p === 'audio.source') updateAudioUi(); });
  $('#audioFile').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) { $('#audioEl').src = URL.createObjectURL(f); $('#audioMsg').textContent = f.name; } });
  $('#btnAudioStart').addEventListener('click', async () => {
    const msg = $('#audioMsg');
    try {
      if (cfg().audio.source === 'file') {
        if (!$('#audioEl').src) { msg.textContent = 'Choose an audio file first'; return; }
        AU.attachFile($('#audioEl')); await $('#audioEl').play(); msg.textContent = 'Playing file – beats drive the wall only in Audio mode';
      } else {
        await AU.startInput(cfg().audio.deviceId || undefined); await fillDevices(); msg.textContent = 'Listening…';
      }
    } catch (e) { msg.textContent = 'Audio error: ' + (e.message || e.name); }
  });
  $('#btnAudioStop').addEventListener('click', () => { AU.stop(); $('#audioMsg').textContent = 'Stopped'; });
  D.bus.on('audio-state', () => { if (!AU.running) $('#audioMsg').textContent = $('#audioMsg').textContent || ''; });

  /* ---------------- settings ---------------- */
  async function openSettings() {
    $('#settingsModal').classList.add('open');
    try {
      if (D.config.isServerMode()) {
        const ifs = await (await fetch('/api/interfaces')).json();
        const sel = $('#ifaceSelect'); const cur = cfg().artnet.bindAddress;
        sel.innerHTML = '<option value="0.0.0.0">All interfaces (0.0.0.0)</option>' + ifs.filter((i) => !i.internal).map((i) => '<option value="' + i.address + '">' + i.name + ' – ' + i.address + '</option>').join('') + '<option value="127.0.0.1">Loopback only (simulator)</option>';
        sel.value = cur;
      }
    } catch (e) { /* ignore */ }
    $('#bridgeNote').textContent = D.config.isServerMode() ? 'Network changes are applied by the bridge immediately.' : 'Bridge not running – start it with start.bat / start.command to use Art-Net.';
    renderChanMap();
  }
  function closeSettings() { $('#settingsModal').classList.remove('open'); }
  $('#btnSettings').addEventListener('click', openSettings);
  $('#btnTigerCfg').addEventListener('click', openSettings);
  $('#setClose').addEventListener('click', closeSettings); $('#setDone').addEventListener('click', closeSettings);
  $('#settingsModal').addEventListener('click', (e) => { if (e.target.id === 'settingsModal') closeSettings(); });
  window.addEventListener('keydown', (e) => { if (e.code === 'Escape' && $('#settingsModal').classList.contains('open')) closeSettings(); });

  function fillProfiles() {
    const sel = $('#profileSelect');
    sel.innerHTML = A.profiles.map((p) => '<option value="' + p.id + '">' + p.name + '</option>').join('') + '<option value="custom">Custom…</option>';
    sel.value = cfg().fixture.profile;
  }
  function renderChanMap() {
    const f = cfg().fixture, roles = A.footprintRoles(), fp = roles.length;
    $('#customRow').hidden = f.profile !== 'custom';
    const step = f.spacing > 0 ? f.spacing : fp;
    const T = cfg().tiger;
    let h = '<table><tr><th>Fixture</th>' + roles.map((r, i) => '<th>+' + i + ' ' + r.toUpperCase() + '</th>').join('') + '</tr>';
    for (let n = 0; n < Math.min(f.count, 8); n++) {
      const base = f.startAddress + n * step;
      h += '<tr><td>#' + (n + 1) + '</td>' + roles.map((r, i) => '<td>ch ' + (base + i) + '</td>').join('') + '</tr>';
    }
    h += '</table><div class="sub">Console: patch the fixture(s) at the addresses above on Art-Net universe ' + cfg().artnet.universe + '.' +
      (T.flashSource === 'channel' ? ' Flash trigger = ch ' + T.flashChannel + '.' : '') +
      (T.patternAdvance !== 'none' && T.patternChannel > 0 ? ' Pattern ' + (T.patternAdvance === 'channelSelect' ? 'select' : 'advance') + ' = ch ' + T.patternChannel + '.' : '') +
      (T.masterChannel > 0 ? ' Master = ch ' + T.masterChannel + '.' : '') + '</div>';
    $('#chanMap').innerHTML = h;
  }
  D.bus.on('config', (p) => { if (/^(fixture|tiger|artnet)\./.test(p)) renderChanMap(); if (p === 'safety.safe') applySafetyLimits(); });

  /* ---------------- output / recording ---------------- */
  // Opens the processor output on the OTHER screen (not the one showing the controls) and keeps the controls usable.
  async function openOutput() {
    if (outWin && !outWin.closed) { outWin.focus(); }
    const guessLeft = screen.isExtended ? (window.screenX + window.outerWidth / 2 < screen.width ? screen.width : -screen.width) : 80;
    const w = (outWin && !outWin.closed) ? outWin : window.open('output.html', 'dls-output', 'popup=yes,left=' + guessLeft + ',top=60,width=1200,height=300');
    if (!w) { alert('Pop-up blocked – allow pop-ups for this page and try again.'); return; }
    outWin = w; D.outWin = w; D.pmNeed = true;
    try {
      if (window.getScreenDetails) {
        const d = await window.getScreenDetails();
        const t = d.screens.find((x) => x !== d.currentScreen && !x.isPrimary) || d.screens.find((x) => x !== d.currentScreen);
        if (t) { w.moveTo(t.availLeft, t.availTop); w.resizeTo(t.availWidth, t.availHeight); }
        $('#outInfo').textContent = d.screens.length > 1 ? 'Output window moved to the extended screen (' + (t ? t.width + '×' + t.height : '?') + '). Click once inside it for fullscreen.' : 'Only one screen detected – connect/extend the second display (Windows: Win+P → Extend).';
      } else {
        $('#outInfo').textContent = 'Output opened. If it is on the wrong screen, drag it to the extended screen, then click inside it once for fullscreen.';
      }
    } catch (e) {
      $('#outInfo').textContent = 'Screen permission denied – drag the output window to the extended screen, then click inside it once for fullscreen.';
    }
  }
  $('#btnOutput').addEventListener('click', openOutput); $('#btnOutput2').addEventListener('click', openOutput);
  $('#btnBlackout').addEventListener('click', () => E.setBlackout(!S.blackout));
  D.bus.on('blackout', (on) => { const b = $('#btnBlackout'); b.classList.toggle('on', on); b.querySelector('.lbl').textContent = on ? 'Blackout on · click to resume' : 'Blackout'; });

  /* ---------------- status chips & monitors ---------------- */
  function setChip(id, cls, text) { const c = $(id); c.className = 'chip ' + cls; c.lastChild.textContent = ' ' + text; }
  function updateChips() {
    const st = A.signalState();
    if (!/^https?:$/.test(location.protocol)) setChip('#chipBridge', 'off', 'Bridge: not used (file mode)');
    else setChip('#chipBridge', A.connected ? 'ok' : 'bad', A.connected ? 'Bridge connected' : 'Bridge offline');
    const map = { ok: ['ok', 'Art-Net ' + A.fps + ' fps'], nosignal: ['warn', 'Art-Net: no signal'], error: ['bad', 'Art-Net: port error'], nobridge: ['off', 'Art-Net: no bridge'] };
    setChip('#chipArtnet', map[st][0], map[st][1]);
    const direct = D.sync.directAlive(), nOut = D.sync.outputs();
    setChip('#chipOut', direct ? 'ok' : nOut ? 'ok' : (outWin && !outWin.closed ? 'bad' : 'off'), direct ? 'Output live (' + (D.outputMode || 'direct') + ')' : nOut ? 'Output live (network)' : (outWin && !outWin.closed ? 'Output NOT receiving' : 'Output: none open'));
    const sf = cfg().safety;
    setChip('#chipSafe', sf.safe ? 'ok' : 'warn', sf.safe ? 'Safe mode ≤ ' + E.effMaxHz() + ' Hz' : 'LIMITS RAISED ≤ ' + E.effMaxHz() + ' Hz');
  }
  setInterval(updateChips, 500);
  D.bus.on('artnet-status', updateChips);

  const bar = (id, v) => { $(id).style.width = (D.util.clamp(v, 0, 1) * 100) + '%'; };
  /* segmented LED meter (bass / mid / treble): lit squares + a falling peak-hold square */
  const SEG = 24, ledPeak = {};
  const led = (id, pid, v) => {
    const n = Math.round(D.util.clamp(v, 0, 1) * SEG);
    $(id).style.clipPath = 'inset(0 ' + ((SEG - n) / SEG * 100) + '% 0 0)';
    ledPeak[id] = Math.max(n, (ledPeak[id] || 0) - 0.18); // holds, then drops ~11 segments/s at 60 fps
    const pk = Math.min(SEG - 1, Math.max(0, Math.round(ledPeak[id]) - 1));
    const u = $(pid); u.style.left = (pk / SEG * 100) + '%'; u.style.opacity = ledPeak[id] > 0.5 ? 1 : 0;
  };
  function updateTiger(t) {
    if (S.mode !== 'tiger' || !$('#body-tiger') || $('#body-tiger').hidden) return;
    const f = A.fixture;
    $('#tSwatch').style.background = 'rgb(' + [f.r, f.g, f.b].map((v) => Math.round(v * (cfg().fixture.dimmerScalesColor ? f.dim : 1))).join(',') + ')';
    bar('#tR', f.r / 255); bar('#tG', f.g / 255); bar('#tB', f.b / 255); bar('#tW', f.w / 255); bar('#tD', f.dim);
    $('#tRv').textContent = Math.round(f.r); $('#tGv').textContent = Math.round(f.g); $('#tBv').textContent = Math.round(f.b); $('#tWv').textContent = Math.round(f.w); $('#tDv').textContent = Math.round(f.dim * 255);
    drawDmx();
    const b = A.bridge, an = b && b.artnet;
    const kv = [['Frames/s (selected universe)', A.fps], ['Universe', cfg().artnet.universe], ['Source', an && an.lastSource || '–'],
      ['Listening', an ? (an.listening ? an.bindAddress + ':' + an.port : 'NO – ' + an.error) : '–'], ['Universes seen', an ? (an.universes.join(', ') || '–') : '–'],
      ['Console flashes accepted', A.triggers], ['Audio/other events ignored', S.ignored.audio + S.ignored.manual], ['Last flash', A.lastTriggerAt ? ((t - A.lastTriggerAt) / 1000).toFixed(1) + ' s ago' : '–']];
    $('#tStats').innerHTML = kv.map((x) => '<span>' + x[0] + '</span><b>' + x[1] + '</b>').join('');
    const st = A.signalState();
    $('#tHelp').textContent = st === 'nobridge' ? 'Start the bridge (start.bat / start.command) and open this page via http://localhost:8080 – browsers cannot receive Art-Net directly.'
      : st === 'error' ? 'Bridge could not open the UDP port: ' + (an && an.error)
      : st === 'nosignal' ? 'No Art-Net data for universe ' + cfg().artnet.universe + '. Check the console\'s Art-Net output, IP/subnet and universe number (see docs/SETUP.md).' : 'Receiving Art-Net. The wall follows the console; audio and keyboard are ignored.';
  }
  const dmxCv = $('#dmxMap'), dmxCtx = dmxCv.getContext('2d');
  function drawDmx() {
    const u = cfg().artnet.universe | 0; const data = A.dmx[u];
    dmxCtx.fillStyle = '#080d14'; dmxCtx.fillRect(0, 0, 512, 64);
    if (data) for (let i = 0; i < 512; i++) { const v = data[i]; if (v) { dmxCtx.fillStyle = 'rgba(92,200,255,' + (0.18 + v / 255 * 0.82) + ')'; dmxCtx.fillRect((i % 64) * 8 + 1, Math.floor(i / 64) * 8 + 1, 6, 6); } else { dmxCtx.fillStyle = '#1a2535'; dmxCtx.fillRect((i % 64) * 8 + 3, Math.floor(i / 64) * 8 + 3, 2, 2); } }
    const f = cfg().fixture, T = cfg().tiger, roles = A.footprintRoles(), step = f.spacing > 0 ? f.spacing : roles.length;
    dmxCtx.lineWidth = 1;
    const box = (ch, col) => { const i = ch - 1; if (i < 0 || i > 511) return; dmxCtx.strokeStyle = col; dmxCtx.strokeRect((i % 64) * 8 + 0.5, Math.floor(i / 64) * 8 + 0.5, 7, 7); };
    for (let n = 0; n < f.count; n++) for (let k = 0; k < roles.length; k++) box(f.startAddress + n * step + k, '#ffb938');
    if (T.flashSource === 'channel') box(T.flashChannel, '#ff9340');
    if (T.patternAdvance !== 'none') box(T.patternChannel, '#4ade80');
    if (T.masterChannel > 0) box(T.masterChannel, '#ff5a5f');
  }
  function updateAudio() {
    if (S.mode !== 'audio' || $('#body-audio').hidden) return;
    led('#mBass', '#pBass', AU.bands.bass); led('#mMid', '#pMid', AU.bands.mid); led('#mTre', '#pTre', AU.bands.treble);
    $('#beatDot').classList.toggle('on', performance.now() < AU.beatFlashUntil);
    $('#bpm').textContent = AU.bpm ? AU.bpm + ' BPM' : '– BPM';
    $('#beatCount').textContent = AU.running ? AU.beats + ' beats' : 'not listening';
  }

  /* ---------------- video layer ---------------- */
  function renderSlots() {
    const V = D.video, box = $('#vslots');
    const upTxt = (s) => s.up === 'uploading' ? ' · uploading…' : s.up === 'error' ? ' · UPLOAD FAILED' : '';
    box.innerHTML = (V.notice ? '<div class="sub warn" style="color:var(--warn)">' + V.notice + '</div>' : '') + V.slots.map((s, i) => '<div class="vslot' + (i === V.cur ? ' active' : '') + '"><b>' + (i + 1) + '</b><span title="' + s.name + '">' + s.name + '</span><small class="' + (s.error || s.up === 'error' ? 'warn' : (s.w && (s.w !== 4000 || s.h !== 500) ? 'warn' : '')) + '" title="' + (s.upMsg ? 'Output window cannot play this clip: ' + s.upMsg : '') + '">' + (s.error ? 'cannot decode (use H.264 MP4 or WebM)' : s.w ? s.w + '×' + s.h + (s.w !== 4000 || s.h !== 500 ? ' (scaled)' : '') : 'loading…') + upTxt(s) + '</small>' + (s.up === 'error' ? '<button class="btn sm" data-retry="' + i + '"><svg class="ic" aria-hidden="true"><use href="#i-refresh"/></svg>retry</button>' : '') + '<button class="btn sm" data-rm="' + i + '" aria-label="Remove clip"><svg class="ic" aria-hidden="true"><use href="#i-close"/></svg></button></div>').join('') || '<div class="sub">No videos loaded – strobe plays on black.</div>';
    $$('[data-retry]', box).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); V.retryUpload(+b.dataset.retry); }));
    $$('[data-rm]', box).forEach((b) => b.addEventListener('click', () => V.remove(+b.dataset.rm)));
    box.querySelectorAll('.vslot').forEach((r, i) => r.addEventListener('click', (e) => { if (e.target.dataset.rm === undefined && S.mode === 'manual') V.choose('manual', i); }));
  }
  function renderSpecial() {
    const sp = D.video.special, box = $('#specialSlot');
    box.innerHTML = sp ? '<div class="vslot' + (D.video.sp ? ' active' : '') + '"><b>★</b><span title="' + sp.name + '">' + sp.name + '</span><small class="' + (sp.error ? 'warn' : '') + '">' + (sp.error ? 'cannot decode' : sp.w ? sp.w + '×' + sp.h + (sp.dur ? ' · ' + Math.round(sp.dur) + ' s' : '') : 'loading…') + '</small><button class="btn sm" data-rmsp="1"' + (D.video.sp ? ' disabled' : '') + ' aria-label="Remove special clip"><svg class="ic" aria-hidden="true"><use href="#i-close"/></svg></button></div><div class="sub" id="spStatus"></div>' : '<div class="sub">No special video loaded.</div>';
    const b = $('[data-rmsp]', box); if (b) b.addEventListener('click', () => D.video.clearSpecial());
    $('#btnSpecialNow').disabled = !sp || D.video.sp;
  }
  $('#specialFile').addEventListener('change', (e) => { if (e.target.files[0]) D.video.setSpecial(e.target.files[0]); e.target.value = ''; });
  $('#btnSpecialNow').addEventListener('click', () => D.video.startSpecial());
  D.bus.on('video-slots', renderSpecial); D.bus.on('video-change', () => { renderSpecial(); $('#btnVideoNext').disabled = S.mode !== 'manual' || D.video.sp; });
  $('#videoFiles').addEventListener('change', (e) => { D.video.add(Array.from(e.target.files)); e.target.value = ''; });
  $('#btnVideoNext').addEventListener('click', () => D.video.change('manual', 0));
  D.bus.on('video-slots', renderSlots); D.bus.on('video-change', renderSlots);
  D.bus.on('mode', () => { $('#btnVideoNext').disabled = S.mode !== 'manual'; });

  /* ---------------- main loop ---------------- */
  let lastDraw = 0;
  function tick() {
    const t = performance.now();
    A.watchdog(t);
    A.strobeTick(t);
    AU.process(t);
    E.tick(t);
    if (t - lastDraw >= 15) {
      lastDraw = t;
      D.video.update(t);
      D.render.drawComposite(stripCtx, S, cfg().output.showLabels, Object.assign({ neon: cfg().neon, neonCap: cfg().safety.safe ? cfg().safety.maxBrightness : 100 }, cfg().video));
      D.frames = (D.frames || 0) + 1;
      D.sync.send(t); D.pm.send(t);
    }
  }
  function startTicker() {
    try {
      const src = 'let id=setInterval(()=>postMessage(0),8);';
      const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      w.onmessage = tick;
    } catch (e) { setInterval(tick, 8); }
  }
  let uiT = 0;
  function frame(t) {
    D.render.drawWall(wall, strip, S.out);
    if (t - uiT > 66) {
      uiT = t; updateTiger(t); updateAudio();
      $('#limitedCount').textContent = S.limited;
      const ss = $('#spStatus'); if (ss) ss.textContent = D.video.specialStatus();
      $$('#testBtns .toggle').forEach((b) => b.classList.toggle('on', b.id === 'testAll' ? S.test.all : S.test.panels.has(+b.dataset.i)));
      $('#btnWhite').classList.toggle('on', cfg().manual.hardWhite);
    }
    requestAnimationFrame(frame);
  }

  /* ---------------- boot ---------------- */
  async function boot() {
    await D.config.load();
    await A.loadProfiles();
    S.colour.manual = cfg().manual.colour.slice();
    buildPatterns(); buildMisc(); fillProfiles();
    refreshControls(); bindControls(); applySafetyLimits();
    S.mode = cfg().mode || 'manual';
    renderMode(); updateAudioUi(); updateChips(); renderSlots(); renderSpecial(); $('#btnVideoNext').disabled = S.mode !== 'manual';
    D.bus.on('config', (p) => { if (p && /^safety\./.test(p)) applySafetyLimits(); });
    fillDevices();
    A.connect();
    startTicker();
    requestAnimationFrame(frame);

    // first-run warning
    const wm = $('#warnModal'), ack = $('#warnAck'), ok = $('#warnOk');
    S.blackout = true; // output stays dark until the warning is acknowledged
    ack.addEventListener('change', () => { ok.disabled = !ack.checked; });
    ok.addEventListener('click', () => { wm.classList.remove('open'); E.setBlackout(false); });
    D.bus.emit('blackout', true);
    window.__dls = D; // handy for debugging / tests
  }
  boot();

  /* neon: style list, auto-switch pool chips, order preview */
  (function () {
    if (!D.neon) return;
    const sel = document.getElementById('neonStyle'), poolBox = document.getElementById('neonPool'), chips = {};
    D.neon.STYLES.forEach((x) => { const o = document.createElement('option'); o.value = x.id; o.textContent = x.label; sel.appendChild(o); });
    D.neon.STYLES.forEach((x) => {
      const b = document.createElement('button'); b.className = 'colchip npchip'; b.textContent = x.label; b.dataset.id = x.id;
      b.addEventListener('click', () => { const off = (cfg().neon.off || []).slice(), i = off.indexOf(x.id); if (i >= 0) off.splice(i, 1); else off.push(x.id); D.config.setPath('neon.off', off); });
      poolBox.appendChild(b); chips[x.id] = b;
    });
    document.getElementById('neonListen').addEventListener('click', () => document.getElementById('btnAudioStart').click());   // same start as the Audio panel (works in every control mode)
    document.getElementById('neonListenStop').addEventListener('click', () => document.getElementById('btnAudioStop').click());
    document.getElementById('neonAllOn').addEventListener('click', () => D.config.setPath('neon.off', []));
    document.getElementById('neonAllOff').addEventListener('click', () => D.config.setPath('neon.off', D.neon.STYLES.map((x) => x.id)));
    refreshControls();
    let last = '';
    setInterval(() => {
      const v = document.getElementById('neonOrderView'), w = document.getElementById('neonCustomWrap'), n = cfg().neon;
      if (!v || !n) return;
      if (w) w.hidden = n.order !== 'custom';
      const cur = D.neon.curStyle(n), off = n.off || [];
      document.getElementById('neonNow').textContent = (n.auto ? 'AUTO · ' : '') + D.neon.STYLES.find((x) => x.id === cur).label;
      Object.keys(chips).forEach((id) => { chips[id].classList.toggle('off', off.indexOf(id) >= 0); chips[id].classList.toggle('on', id === cur && !!n.auto); });
      document.getElementById('neonPoolCount').textContent = '(' + (D.neon.STYLES.length - off.length) + '/' + D.neon.STYLES.length + ' on)';
      const st = D.neon.status(n), am = document.getElementById('audioMsg'), box = document.getElementById('neonAudio');
      box.textContent = !n.auto ? 'Auto-switch is OFF – style stays fixed.' : st.listening ? 'Listening · ' + (st.bpm || '–') + ' BPM · next style in ' + st.left + ' beat' + (st.left === 1 ? '' : 's')
        : (am && am.textContent && /denied|error|not|fail/i.test(am.textContent) ? 'Warning: ' + am.textContent + ' · ' : '') + (st.sec ? 'No audio – switching every ' + st.sec + ' s · press Listen for beat sync' : 'No audio – press Listen (mic / audio interface) to switch on beats');
      const seq = D.neon.describe(n);
      const html = seq.length ? seq.map((x, i) => '<span class="no"><b>P' + x.p + '</b><i>slot ' + x.slot + '</i></span>' + (i < seq.length - 1 ? '<em>›</em>' : '')).join('') : '<span class="no all">all panels at once</span>';
      if (html !== last) { last = html; v.innerHTML = html; }
    }, 400);
  })();
})();
