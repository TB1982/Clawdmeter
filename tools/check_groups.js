#!/usr/bin/env node
// Check that every animation name the firmware asks for by literal string
// actually exists in the build, and report which built animations nothing ever
// picks.
//
// This exists because of a failure mode that is invisible from the outside. An
// animation can convert cleanly into splash_animations.h and still never once
// appear on the device, because appearing requires its name to also be listed
// in GROUP_NAMES in splash.cpp, matched by exact string. Cycling to it by hand
// with the "next" serial command renders it perfectly either way, so the broken
// case and the working case look identical on the panel. A typo, a rename, or
// simply forgetting the second step costs you nothing at build time and
// everything at runtime.
//
//   node tools/check_groups.js        # exits non-zero if a name resolves to nothing
//
// Run it after adding, renaming, or excluding an animation.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HDR = path.join(ROOT, 'firmware/src/splash_animations.h');
const SPLASH = path.join(ROOT, 'firmware/src/splash.cpp');
const SRC_DIR = path.join(ROOT, 'firmware/src');

const stripComments = s => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map(l => l.replace(/\/\/.*/, '')).join('\n');

// --- what is actually in the build ------------------------------------------
const built = [...fs.readFileSync(HDR, 'utf8').matchAll(/\{"([^"]+)", "/g)].map(m => m[1]);
const builtSet = new Set(built);

// --- what the rate groups ask for -------------------------------------------
const splash = fs.readFileSync(SPLASH, 'utf8');
const block = splash.match(/GROUP_NAMES\[GROUP_COUNT\]\[GROUP_MAX\] = \{([\s\S]*?)\n\};/);
if (!block) {
  console.error('could not find GROUP_NAMES in splash.cpp — has it been renamed?');
  process.exit(2);
}
const groups = stripComments(block[1])
  .split('\n').join(' ')
  .split('},')
  .map(row => [...row.matchAll(/"([^"]+)"/g)].map(m => m[1]))
  .filter(g => g.length);

// --- names hardcoded outside splash.cpp (the usage screen names one) ---------
const direct = [];
for (const f of fs.readdirSync(SRC_DIR)) {
  if (!f.endsWith('.cpp') || f === 'splash.cpp') continue;
  const txt = stripComments(fs.readFileSync(path.join(SRC_DIR, f), 'utf8'));
  for (const m of txt.matchAll(/splash_mini_create\s*\([^,]+,\s*"([^"]+)"/g)) direct.push([f, m[1]]);
}
// Animations named by #define rather than inline (opening, celebration).
const defines = [...stripComments(splash).matchAll(/#define\s+(SPLASH_\w*ANIM)\s+"([^"]+)"/g)]
  .map(m => [m[1], m[2]]);

// --- report ------------------------------------------------------------------
let fatal = 0;
console.log(`${built.length} animations in the build\n`);

groups.forEach((g, i) => {
  const marks = g.map(n => {
    if (builtSet.has(n)) return n;
    fatal++;
    return `${n}  <-- NOT IN BUILD`;
  });
  console.log(`group ${i} (${g.length}/9): ${marks.join(', ')}`);
});

const named = new Set([...groups.flat(), ...direct.map(d => d[1]), ...defines.map(d => d[1])]);

if (direct.length || defines.length) console.log('');
direct.forEach(([f, n]) => {
  const ok = builtSet.has(n);
  if (!ok) fatal++;
  console.log(`${f} names "${n}" directly${ok ? '' : '  <-- NOT IN BUILD'}`);
});
defines.forEach(([d, n]) => {
  const ok = builtSet.has(n);
  if (!ok) fatal++;
  console.log(`${d} = "${n}"${ok ? '' : '  <-- NOT IN BUILD'}`);
});

const orphans = built.filter(n => !named.has(n));
if (orphans.length) {
  console.log(`\n${orphans.length} in the build that nothing picks (fine if deliberate):`);
  orphans.forEach(n => console.log(`  ${n}`));
}

console.log('');
if (fatal) {
  console.error(`FAIL: ${fatal} name(s) resolve to nothing — they would silently never appear.`);
  process.exit(1);
}
console.log('OK: every name the firmware asks for exists in the build.');
