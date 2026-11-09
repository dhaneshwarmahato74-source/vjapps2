'use strict';
// Runs on the Mac build machine: compiles the tiny "unmirror" helper (universal binary).
// If anything fails, a harmless stub is written so the build never breaks.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
exports.default = async function (context) {
  if (context.electronPlatformName !== 'darwin') return;
  const dir = path.join(__dirname, 'mac');
  const out = path.join(dir, 'dk-unmirror');
  if (fs.existsSync(out)) return;
  try {
    execFileSync('clang', ['-arch', 'arm64', '-arch', 'x86_64', '-framework', 'ApplicationServices', '-o', out, path.join(dir, 'unmirror.c')], { stdio: 'inherit' });
  } catch (e) {
    console.warn('unmirror helper could not be compiled, using stub:', e.message);
    fs.writeFileSync(out, '#!/bin/sh\nexit 0\n');
  }
  fs.chmodSync(out, 0o755);
};
