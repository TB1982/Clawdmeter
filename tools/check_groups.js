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
// tools/sync_animations.js runs this as its last step, so normally you get it
// for free. Run it directly after hand-editing GROUP_NAMES.
const M = require('./lib/firmware_meta.js');

const built = M.built();
const builtSet = new Set(built.map(a => a.name));
const groups = M.groups();
const direct = M.directNames();
const defs = M.defines();

let fatal = 0;
const require_ = name => {
  if (builtSet.has(name)) return name;
  fatal++;
  return `${name}  <-- NOT IN BUILD`;
};

console.log(`${built.length} animations in the build\n`);

groups.forEach((g, i) => {
  console.log(`group ${i} (${g.length}/9): ${g.map(require_).join(', ')}`);
});

if (direct.length || defs.length) console.log('');
direct.forEach(d => console.log(`${d.file} names "${require_(d.name)}" directly`));
defs.forEach(d => console.log(`${d.macro} = "${require_(d.name)}"`));

const named = new Set([...groups.flat(), ...direct.map(d => d.name), ...defs.map(d => d.name)]);
const orphans = built.filter(a => !named.has(a.name));
if (orphans.length) {
  console.log(`\n${orphans.length} in the build that nothing picks (fine if deliberate):`);
  orphans.forEach(a => console.log(`  ${a.name}`));
}

console.log('');
if (fatal) {
  console.error(`FAIL: ${fatal} name(s) resolve to nothing — they would silently never appear.`);
  process.exit(1);
}
console.log('OK: every name the firmware asks for exists in the build.');
