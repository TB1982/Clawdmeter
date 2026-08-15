#!/usr/bin/env node
// One command for "I changed an animation".
//
// Four things have to happen together and they are easy to do three of. The
// header feeds the firmware, the editor's embedded samples feed the web page,
// the catalogue feeds the docs, and the check catches the name that reaches
// none of them. Forgetting the samples ships a device and a web page that
// disagree; forgetting the check ships an animation that is compiled in and
// never once appears.
//
//   node tools/sync_animations.js
//
// Then build and flash. Stops at the first failure with a non-zero exit, so it
// is safe to chain in front of a build.
const {execFileSync} = require('child_process');
const path = require('path');

const STEPS = [
  ['convert_to_c.js',         'animations  -> firmware/src/splash_animations.h'],
  ['build_editor_samples.js', 'animations  -> tools/anim_editor.html samples'],
  // The published copy is rebuilt here rather than by hand, because the failure
  // it prevents is silent: a new animation lands, the local editor gets it, and
  // the one strangers actually open is a version behind with nothing to say so.
  ['build_editor_samples.js', 'own + official only -> docs/anim_editor.html', ['--public']],
  ['gen_catalogue.js',        'firmware    -> docs/animation-catalogue.md'],
  ['check_groups.js',         'every name the firmware asks for resolves'],
  ['check_editor.js',         'the editor parses and its grid maths hold'],
];

let n = 0;
for (const [script, what, args = []] of STEPS) {
  n++;
  console.log(`\n\x1b[1m[${n}/${STEPS.length}] ${script}\x1b[0m  ${what}`);
  try {
    execFileSync(process.execPath, [path.join(__dirname, script), ...args], {stdio: 'inherit'});
  } catch (e) {
    console.error(`\n\x1b[31mstopped at ${script}\x1b[0m — nothing after it ran.`);
    process.exit(e.status || 1);
  }
}

console.log(`
\x1b[1mSynced.\x1b[0m Firmware header, editor samples, and the catalogue all agree.

Next:
  pio run -d firmware                                   # all six boards
  pio run -d firmware -e waveshare_amoled_216 -t upload --upload-port /dev/cu.usbmodem101
`);
