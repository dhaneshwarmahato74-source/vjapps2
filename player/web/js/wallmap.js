/* Wall mapping – the LED Mapper's engine inside the Player.
   Video clips are treated as ONE master picture covering the whole diamond wall (2-2-3-1, 1244x1377 reference px);
   every 500x500 cabinet samples its own 45°-rotated region of it and the 8 tiles are packed into the 4000x500 output.
   Calibration (zoom/pan, per-cabinet offsets, orientation, wiring order…) is made in mapper.html and shared through
   localStorage 'dlvm_v4' (live: the 'storage' event) and, for output pages on another PC, through the frame sync message. */
(function () {
  'use strict';
  const D = window.DLS = window.DLS || {};
  const REF = { W: 1244, H: 1377, D: 207, cabs: [[325, 207], [919, 207], [414.5, 531], [829, 531], [208, 739], [622, 739], [1037, 739], [622, 1170]] };
  const SIDE = REF.D * Math.SQRT2, K0 = SIDE / 500, N = 8, OUTW = 4000, OUTH = 500, KEY = 'dlvm_v4';
  const DEF = () => ({ mode: 'physical', fit: 'cover', zoom: 1, panX: 0, panY: 0, rotDir: 1, baseAngle: 45, cabScale: 1,
    cabs: Array.from({ length: 8 }, (_, i) => ({ dx: 0, dy: 0, scale: 1, orient: 0, label: i + 1 })), wiring: [1, 2, 3, 4, 5, 6, 7, 8] });
  let cal = DEF(), calJson = JSON.stringify(cal);
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

  function normalize(j) {
    if (!j || !Array.isArray(j.cabs) || j.cabs.length !== 8) return null;
    const d = DEF();
    d.mode = j.mode === 'strip' ? 'strip' : 'physical';
    d.fit = ['cover', 'contain', 'stretch'].indexOf(j.fit) >= 0 ? j.fit : 'cover';
    d.zoom = num(j.zoom, 1) > 0 ? num(j.zoom, 1) : 1; d.panX = num(j.panX, 0); d.panY = num(j.panY, 0);
    d.rotDir = j.rotDir === -1 ? -1 : 1; d.baseAngle = num(j.baseAngle, 45); d.cabScale = num(j.cabScale, 1) > 0 ? num(j.cabScale, 1) : 1;
    d.cabs = j.cabs.map((c, i) => ({ dx: num(c.dx, 0), dy: num(c.dy, 0), scale: num(c.scale, 1) > 0 ? num(c.scale, 1) : 1, orient: num(c.orient, 0), label: num(c.label, i + 1) }));
    if (Array.isArray(j.wiring) && j.wiring.length === 8) d.wiring = j.wiring.map((x) => x | 0);
    return d;
  }
  let s2c = [0, 1, 2, 3, 4, 5, 6, 7], c2s = [0, 1, 2, 3, 4, 5, 6, 7], wireOk = true;
  function rebuild() { // slot -> cabinet index and back (identity if the wiring is not a valid 1:1 assignment, like the Mapper)
    const L = new Set(cal.cabs.map((c) => c.label)), W = new Set(cal.wiring);
    wireOk = L.size === 8 && W.size === 8 && cal.wiring.every((x) => L.has(x));
    for (let s = 0; s < N; s++) { let ci = wireOk ? cal.cabs.findIndex((c) => c.label === cal.wiring[s]) : s; if (ci < 0) ci = s; s2c[s] = ci; c2s[ci] = s; }
  }
  function setCal(j) { const n = normalize(j); if (!n) return false; cal = n; calJson = JSON.stringify(n); rebuild(); return true; }
  function load() { try { setCal(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch (e) { /* keep current */ } }
  load();
  window.addEventListener('storage', (e) => { if (e.key === KEY) { load(); if (D.bus) D.bus.emit('wiring'); } });

  const wiringValid = () => { const L = new Set(cal.cabs.map((c) => c.label)), W = new Set(cal.wiring); return L.size === 8 && W.size === 8 && cal.wiring.every((w) => L.has(w)); };
  function slotList() {
    const ok = wiringValid(), out = [];
    for (let s = 0; s < N; s++) {
      let ci = ok ? cal.cabs.findIndex((c) => c.label === cal.wiring[s]) : s; if (ci < 0) ci = s;
      const c = cal.cabs[ci], r = REF.cabs[ci];
      out.push({ cx: r[0] + c.dx, cy: r[1] + c.dy, k: K0 * cal.cabScale * c.scale, th: (cal.rotDir * cal.baseAngle + c.orient) * Math.PI / 180 });
    }
    return out;
  }

  let glc = null, gl = null, prog = null, tex = null, loc = {}, failed = false;
  const VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  const FS = `precision highp float;
uniform sampler2D uTex;uniform vec2 uVid,uWall,uSc,uPan;uniform vec4 uCab[8];uniform int uMode;
vec3 smp(vec2 o){
  vec2 w;
  if(uMode==1){w=o;}
  else{
    float slot=floor(o.x/500.0);
    vec2 l=vec2(o.x-slot*500.0-250.0,o.y-250.0);
    vec4 c=vec4(0.0);
    for(int i=0;i<8;i++){if(float(i)==slot)c=uCab[i];}
    float cs=cos(c.w),sn=sin(c.w);
    w=c.xy+c.z*vec2(cs*l.x-sn*l.y,sn*l.x+cs*l.y);
  }
  vec2 v=uVid*0.5+uPan*uVid+(w-uWall*0.5)/uSc;
  vec2 uv=v/uVid;
  float inside=step(0.0,uv.x)*step(uv.x,1.0)*step(0.0,uv.y)*step(uv.y,1.0);
  return texture2D(uTex,clamp(uv,0.0,1.0)).rgb*inside;
}
void main(){
  vec2 o=vec2(gl_FragCoord.x,500.0-gl_FragCoord.y);
  vec3 c=smp(o+vec2(-.25,-.25))+smp(o+vec2(.25,-.25))+smp(o+vec2(-.25,.25))+smp(o+vec2(.25,.25));
  gl_FragColor=vec4(c*0.25,1.0);
}`;
  function init() {
    if (gl) return true; if (failed) return false;
    try {
      glc = document.createElement('canvas'); glc.width = OUTW; glc.height = OUTH;
      gl = glc.getContext('webgl', { preserveDrawingBuffer: true, antialias: false, alpha: false });
      if (!gl) throw new Error('no webgl');
      const mk = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      prog = gl.createProgram(); gl.attachShader(prog, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog); gl.useProgram(prog);
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const a = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
      ['uTex', 'uVid', 'uWall', 'uSc', 'uPan', 'uCab', 'uMode'].forEach((n) => { loc[n] = gl.getUniformLocation(prog, n); });
      tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.viewport(0, 0, OUTW, OUTH);
      return true;
    } catch (e) { failed = true; gl = null; return false; }
  }
  const u = new Float32Array(32);
  function render(el) {
    const vw = el.videoWidth || el.width, vh = el.videoHeight || el.height; if (!vw || !vh) return false;
    const strip = cal.mode === 'strip', W = strip ? OUTW : REF.W, H = strip ? OUTH : REF.H;
    let sx, sy;
    if (cal.fit === 'stretch') { sx = W / vw; sy = H / vh; } else { const a = W / vw, b = H / vh, s = cal.fit === 'cover' ? Math.max(a, b) : Math.min(a, b); sx = sy = s; }
    sx *= cal.zoom; sy *= cal.zoom;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
    slotList().forEach((q, i) => { u[i * 4] = q.cx; u[i * 4 + 1] = q.cy; u[i * 4 + 2] = q.k; u[i * 4 + 3] = q.th; });
    gl.uniform1i(loc.uTex, 0); gl.uniform2f(loc.uVid, vw, vh); gl.uniform2f(loc.uWall, W, H);
    gl.uniform2f(loc.uSc, sx, sy); gl.uniform2f(loc.uPan, cal.panX, cal.panY);
    gl.uniform4fv(loc.uCab, u); gl.uniform1i(loc.uMode, strip ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  }

  D.wallmap = {
    /* draw video element `el` into the 4000x500 context through the diamond-wall mapping (falls back to plain stretch) */
    draw(ctx, el, w, h) {
      if (init() && render(el)) ctx.drawImage(glc, 0, 0, w, h); else ctx.drawImage(el, 0, 0, w, h);
    },
    ok() { return init(); },
    /* 'auto': a clip that is already a 4000x500 strip (aspect ~8:1) goes straight to the output; anything else is mapped onto the diamond wall.
       'wall' = always map, 'stretch' = always straight. */
    useWall(mode, el) {
      if (mode === 'stretch') return false;
      if (mode === 'wall') return true;
      const vw = el.videoWidth || el.width || 0, vh = el.videoHeight || el.height || 0;
      return !(vw && vh && vw / vh > 6 && vw / vh < 10);
    },
    slotCab(s) { return s2c[s] == null ? s : s2c[s]; },            // processor slot (0-7) -> cabinet index (0-7)
    cabSlot(c) { return c2s[c] == null ? c : c2s[c]; },            // cabinet index -> processor slot
    label(c) { return cal.cabs[c] ? cal.cabs[c].label : c + 1; },  // number printed on the cabinet
    theta(c) { const k = cal.cabs[c]; return ((cal.rotDir * cal.baseAngle) + (k ? k.orient : 0)) * Math.PI / 180; },
    wiringOk() { return wireOk; },
    /* change wiring / cabinet labels / orientation and share it with the Mapper tab (same localStorage entry) */
    update(fn) {
      const n = JSON.parse(JSON.stringify(cal)); fn(n); if (!setCal(n)) return false;
      try {
        let old = null; try { old = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { /* ignore */ }
        const base = Object.assign({}, cal, old || {});
        base.wiring = cal.wiring.slice();
        base.cabs = cal.cabs.map((c, i) => Object.assign({}, old && old.cabs && old.cabs[i], c));
        localStorage.setItem(KEY, JSON.stringify(base));
      } catch (e) { /* ignore */ }
      if (D.bus) D.bus.emit('wiring');
      return true;
    },
    get() { return cal; }, json() { return calJson; }, set(j) { return setCal(j); }, reload: load
  };
})();
