// Read back what the firmware actually contains and what it asks for.
//
// Both check_groups.js and gen_catalogue.js need the same handful of facts, and
// a regex over splash.cpp that lives in two files will go stale in one of them.
// Everything here parses the generated header and the hand-written firmware
// sources, never the JSON in tools/ -- the question these answer is always
// "what is on the device", not "what did we draw".
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const P = {
  header:  path.join(ROOT, 'firmware/src/splash_animations.h'),
  splash:  path.join(ROOT, 'firmware/src/splash.cpp'),
  srcDir:  path.join(ROOT, 'firmware/src'),
  convert: path.join(ROOT, 'tools/convert_to_c.js'),
};

// C and JS both use // and /* */, and a name inside a comment must never count
// as a name the firmware asks for.
const stripComments = s => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map(l => l.replace(/\/\/.*/, '')).join('\n');

const read = f => fs.readFileSync(f, 'utf8');

// Every animation compiled into the build, with the timing that ships.
// splash_anims[] rows are {"name", "Category", frames, side, palette, frames, holds}.
// Category is [^"]* and not [^"]+: the converter emits "" for a drawing that was
// never given one, and requiring a character made that animation invisible to
// every tool built on this reader — including check_groups.js, which then
// reported it as missing from a build it was actually in.
function built() {
  const hdr = read(P.header);
  const holds = {};
  for (const m of hdr.matchAll(/static const uint16_t (\w+_holds)\[\d+\] = \{([^}]*)\}/g)) {
    holds[m[1]] = m[2].split(',').map(Number);
  }
  const out = [];
  for (const m of hdr.matchAll(/\{"([^"]+)", "([^"]*)", (\d+), (\d+), \w+, \w+, (\w+)\}/g)) {
    const h = holds[m[5]] || [];
    out.push({
      name: m[1],
      category: m[2],
      frames: +m[3],
      side: +m[4],
      holds: h,
      loopMs: h.reduce((s, v) => s + v, 0),
    });
  }
  return out;
}

// The rate groups, in playback order, as literal names.
function groups() {
  const block = read(P.splash).match(/GROUP_NAMES\[GROUP_COUNT\]\[GROUP_MAX\] = \{([\s\S]*?)\n\};/);
  if (!block) throw new Error('GROUP_NAMES not found in splash.cpp — renamed?');
  return stripComments(block[1])
    .split('},')
    .map(row => [...row.matchAll(/"([^"]+)"/g)].map(m => m[1]))
    .filter(g => g.length);
}

// Names hardcoded outside splash.cpp. The usage screen names one directly
// because it draws a fixed animation rather than picking from a rate group,
// which makes that name un-excludable.
function directNames() {
  const out = [];
  for (const f of fs.readdirSync(P.srcDir)) {
    if (!f.endsWith('.cpp') || f === 'splash.cpp') continue;
    const txt = stripComments(read(path.join(P.srcDir, f)));
    for (const m of txt.matchAll(/splash_mini_create\s*\([^,]+,\s*"([^"]+)"/g)) out.push({file: f, name: m[1]});
    // The weather screen picks by condition from WEATHER_ANIMS[], so its names
    // never appear at a splash_mini_create() call. Reaching them through the
    // table is the only way they get checked, and they need it more than most:
    // a name that resolves to nothing here shows the same empty slot as a
    // category nobody has drawn yet, so it would never look like a bug.
    const wx = txt.match(/WEATHER_ANIMS\[\] = \{([\s\S]*?)\n\};/);
    if (wx) for (const m of wx[1].matchAll(/"([^"]+)"\s*\}/g)) out.push({file: f, name: m[1]});
  }
  return out;
}

// Animations named by #define rather than by a group: the boot opening and the
// reset celebration.
function defines() {
  return [...stripComments(read(P.splash)).matchAll(/#define\s+(SPLASH_\w*ANIM)\s+"([^"]+)"/g)]
    .map(m => ({macro: m[1], name: m[2]}));
}

// How long each animation holds the splash before the group advances.
function rotateMs() {
  const m = read(P.splash).match(/#define\s+SPLASH_ROTATE_INTERVAL_MS\s+(\d+)/);
  return m ? +m[1] : null;
}

// Drawn and kept as editor samples, but deliberately kept out of the firmware.
function excluded() {
  // Strip the comments first. They are prose, and English possessives ("Nova's
  // call", "that group's three") put stray apostrophes inside the block, which
  // makes a naive quoted-string match pair the wrong quotes and return
  // fragments of sentences as animation names.
  const m = read(P.convert).match(/const EXCLUDE = new Set\(\[([\s\S]*?)\]\)/);
  if (!m) return [];
  return [...stripComments(m[1]).matchAll(/'([^']+)'/g)].map(x => x[1]);
}

module.exports = {built, groups, directNames, defines, rotateMs, excluded, stripComments, paths: P};
