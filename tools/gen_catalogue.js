#!/usr/bin/env node
// Write docs/animation-catalogue.md from what is actually in the firmware.
//
// Generated rather than hand-written on purpose. A hand-maintained list of
// what ships and in what order is wrong the first time someone reorders a
// group and forgets, and a list that is wrong is worse than no list, because
// it is read as true. Everything here is derived from splash_animations.h and
// splash.cpp, so it cannot disagree with the build.
//
//   node tools/gen_catalogue.js
//
// Normally you do not run this directly -- tools/sync_animations.js runs it as
// one step of the whole update.
const fs = require('fs');
const path = require('path');
const M = require('./lib/firmware_meta.js');

const OUT = path.join(__dirname, '..', 'docs/animation-catalogue.md');

const built = M.built();
const byName = Object.fromEntries(built.map(a => [a.name, a]));
const groups = M.groups();
const direct = M.directNames();
const defs = M.defines();
const slot = M.rotateMs();
const excluded = M.excluded();

const GROUP_LABEL = [
  '0 — idle',
  '1 — normal',
  '2 — active',
  '3 — heavy',
];

const ms = n => n.toLocaleString('en-US');

// A loop that does not divide the slot gets cut part-way through when the
// rotation moves on; whether that matters is a judgement, so report it rather
// than flagging it as wrong.
function loops(a) {
  if (!a || !a.loopMs) return {text: '—', clean: false};
  const n = slot / a.loopMs;
  const clean = Math.abs(n - Math.round(n)) < 0.01;
  return {text: n.toFixed(2).replace(/\.00$/, '') + (clean ? ' ✓' : ''), clean};
}

const L = [];
L.push('# What is on the device');
L.push('');
L.push('**Generated — do not hand-edit.** Rebuild it with:');
L.push('');
L.push('```bash');
L.push('node tools/sync_animations.js');
L.push('```');
L.push('');
L.push('Read from `firmware/src/splash_animations.h` and `firmware/src/splash.cpp`, so');
L.push('it cannot disagree with the build. For *why* an animation looks the way it does,');
L.push('see [`animation-craft.md`](animation-craft.md); for how the pipeline works, see');
L.push('[`../tools/README.md`](../tools/README.md).');
L.push('');
L.push(`${built.length} animations are compiled in. The splash shows one for ` +
       `**${ms(slot)} ms** and then advances to the next entry in the group the current`);
L.push('usage rate selects, wrapping at the end. The order below *is* the playback order:');
L.push('slot 0 is what you meet at boot, and the last slot is what loops back into it.');
L.push('');

groups.forEach((g, i) => {
  const total = g.reduce((s, n) => s + (byName[n] ? byName[n].loopMs : 0), 0);
  const round = g.length * slot;
  L.push(`## Group ${GROUP_LABEL[i] || i}`);
  L.push('');
  L.push(`${g.length} of 9 slots · one full round is ${(round / 1000).toFixed(0)} s`);
  L.push('');
  L.push('| # | animation | frames | one loop | loops per slot |');
  L.push('|---|---|---|---|---|');
  g.forEach((n, k) => {
    const a = byName[n];
    if (!a) { L.push(`| ${k + 1} | **${n}** | — | — | **not in the build** |`); return; }
    L.push(`| ${k + 1} | ${n} | ${a.frames} | ${ms(a.loopMs)} ms | ${loops(a).text} |`);
  });
  L.push('');
  if (total === 0) L.push('');
});

const clean = groups.flat().map(n => byName[n]).filter(a => a && loops(a).clean);
L.push('A ✓ means the loop divides the slot exactly, so it is never cut part-way. ' +
       (clean.length
         ? `${clean.length} of ${groups.flat().length} do: ${clean.map(a => a.name).join(', ')}.`
         : 'None currently do.'));
L.push('');

L.push('## Not picked by a rate group');
L.push('');
if (defs.length || direct.length) {
  L.push('| animation | role |');
  L.push('|---|---|');
  defs.forEach(d => {
    const known = byName[d.name];
    L.push(`| ${d.name} | \`${d.macro}\`${known ? '' : ' — **not in the build**'} |`);
  });
  direct.forEach(d => {
    const known = byName[d.name];
    L.push(`| ${d.name} | named directly by \`${d.file}\`${known ? '' : ' — **not in the build**'} |`);
  });
  L.push('');
  L.push('A name in this table cannot be excluded from the build without breaking the');
  L.push('thing that asks for it — unlike a group entry, which only stops being picked.');
  L.push('');
}

const named = new Set([...groups.flat(), ...direct.map(d => d.name), ...defs.map(d => d.name)]);
const orphans = built.filter(a => !named.has(a.name));
L.push('## In the build, picked by nothing');
L.push('');
if (orphans.length) {
  orphans.forEach(a => L.push(`- \`${a.name}\` — ${a.frames} frames, ${ms(a.loopMs)} ms`));
  L.push('');
  L.push('These cost flash and never appear. That is a legitimate choice, but it should');
  L.push('be a choice — `node tools/check_groups.js` prints this list too, so a name that');
  L.push('landed here by accident shows up rather than going quiet.');
} else {
  L.push('None — everything compiled in is reachable.');
}
L.push('');

L.push('## Drawn, but kept out of the firmware');
L.push('');
if (excluded.length) {
  L.push('`EXCLUDE` in `tools/convert_to_c.js`. They remain loadable as editor samples,');
  L.push('so a retired animation can still be opened and reworked:');
  L.push('');
  excluded.forEach(n => L.push(`- ${n}`));
} else {
  L.push('None.');
}
L.push('');

fs.writeFileSync(OUT, L.join('\n'));
console.log(`wrote ${path.relative(path.join(__dirname, '..'), OUT)} — ` +
  `${built.length} animations, ${groups.length} groups, ${orphans.length} unpicked, ${excluded.length} excluded`);
