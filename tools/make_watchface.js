#!/usr/bin/env node
/**
 * Turns an animation from the catalogue into a Xiaomi watchface project that
 * the .face packer can build.
 *
 * The output is a folder, not a finished watchface: a `.fprj` (the project XML),
 * an `images/` folder of frames, and an empty `output/`. Packing it into a
 * `.face` is a separate step that only Xiaomi's own compiler can do — see
 * "Why this stops short of a .face" below.
 *
 *   node tools/make_watchface.js waiting
 *   node tools/make_watchface.js "this is fine" --out /tmp/wf --device 11
 *
 * Options:
 *   --out DIR      where to write the project   (default tools/export/watchface/)
 *   --device ID    Xiaomi device code           (default 11, Smart Band 8 Pro)
 *   --frames N     how many frames to keep      (default 10)
 *
 * ── How the animation actually plays ───────────────────────────────────────
 *
 * A Xiaomi watchface has no free-running animation primitive. Motion comes from
 * an ImageList widget whose visible frame is chosen by a *data source* — and of
 * the 80 sources this band exposes, the fastest is the seconds value. So this
 * generator binds the frames to "Second Low" (the ones digit of the seconds,
 * 0-9) and the animation advances once per second, looping every ten.
 *
 * That is a real ceiling for this approach, and it is the reason for --frames 10:
 * a source that counts 0-9 can only ever index ten pictures.
 *
 * It is NOT the ceiling of the hardware. These bands run NuttX with LVGL and a
 * Lua engine, and a Lua watchface can drive its own frames — m0tral's published
 * Band 8 Pro samples tick at 50 ms, which is 20 fps, fast enough for every
 * animation in this catalogue at its authored speed. That path needs the frames
 * as LVGL .bin images (which tools/png_to_lvgl.js already knows how to make) and
 * a main.lua, and it is the better target once this simpler one is proven end to
 * end on real hardware.
 *
 * ── Which frames get kept ──────────────────────────────────────────────────
 *
 * Evenly spaced across the animation. That is only safe because the animations
 * worth putting on a band are the ones whose motion *steps* rather than flows —
 * rain, flicker, blinking — where dropping frames reads as a slower version of
 * the same thing. `waiting` measures as a static scene with randomised rain (no
 * detectable period: every frame differs from every other by 35-45 of 400 cells),
 * so any ten of its twenty-five are as good as any other ten.
 *
 * Run it on something that flows — a jump, a firework blooming — and even
 * spacing will produce a stutter, because there is continuous motion to break.
 * That is a property of the animation, not a bug here.
 *
 * ── Why this stops short of a .face ────────────────────────────────────────
 *
 * The only packer that exists is Xiaomi's own, distributed as a Windows binary
 * inside Mi Create. It runs on macOS under Mono as far as "App found, packing.."
 * and then dies: it embeds a 2015-era Magick.NET whose native half is a Windows
 * DLL, and that cannot be substituted (it exports Magick.NET's own shim, not
 * stock ImageMagick's API). Three other obstacles on that path *were* solvable —
 * hardcoded backslash paths (MONO_IOMAP=all), a WPF reference in a method
 * signature (a stub PresentationCore.dll), and the missing darwin branch in Mi
 * Create itself — but this one is not worth the effort it would take.
 *
 * So packing happens on a Windows runner instead; see
 * .github/workflows/build-watchface.yml, which runs this script and then the
 * packer, and hands back the .face as an artifact.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { writeRgbPng } = require('./lib/png');

const args = process.argv.slice(2);
const opt = (k, def) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : def; };

// Panel geometry per device code, copied from Mi Create's devices.json. The Pro
// line has been the same panel for three generations, which is why a face built
// for 11 is pixel-identical on a Band 10 Pro.
const DEVICES = {
  '11':  { name: 'Xiaomi Smart Band 8 Pro',  w: 336, h: 480 },
  '367': { name: 'Xiaomi Smart Band 9 Pro',  w: 336, h: 480 },
  '366': { name: 'Xiaomi Smart Band 9',      w: 192, h: 490 },
  '466': { name: 'Xiaomi Smart Band 10',     w: 212, h: 520 },
};

const SECOND_LOW = '1911';   // ones digit of the seconds, 0-9

const name = args.find(a => !a.startsWith('--') &&
  !['--out', '--device', '--frames'].includes(args[args.indexOf(a) - 1]));
if (!name) { console.error('usage: node tools/make_watchface.js <animation> [--out DIR] [--device ID] [--frames N]'); process.exit(1); }

const deviceId = opt('--device', '11');
const device = DEVICES[deviceId];
if (!device) {
  console.error(`unknown device code "${deviceId}". Known: ${Object.keys(DEVICES).join(', ')}`);
  process.exit(1);
}

const KEEP = parseInt(opt('--frames', '10'), 10);
if (KEEP < 1 || KEEP > 10) {
  // Second Low counts 0-9 and nothing else this band offers ticks faster.
  console.error(`--frames must be 1..10 (the seconds digit only counts that far); got ${KEEP}`);
  process.exit(1);
}

const OUT = path.resolve(opt('--out', path.join(__dirname, 'export', 'watchface')));
const slug = name.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
const proj = path.join(OUT, slug);

// Find the animation so we can count its frames before rendering any.
let anim = null;
for (const d of ['claudepix_data', 'custom_anims', 'drawn_anims', 'official_anims']) {
  const dir = path.join(__dirname, d);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith('.json') || f.startsWith('_')) continue;
    const a = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (a.name === name) anim = a;
  }
}
if (!anim) { console.error(`no animation named "${name}"`); process.exit(1); }

const side = anim.frames[0].grid.length;
const cell = Math.floor(Math.min(device.w, device.h) / side);

// Render every frame at panel size, bottom-anchored — the top of a watch face is
// where the clock goes, so the art belongs at the bottom. export_gif.js is the
// one renderer, called rather than reimplemented so both paths cannot drift.
const staging = path.join(OUT, '_frames');
fs.rmSync(staging, { recursive: true, force: true });
execFileSync(process.execPath, [
  path.join(__dirname, 'export_gif.js'), name,
  '--canvas', `${device.w}x${device.h}`, '--cell', String(cell),
  '--anchor', 'bottom', '--frames', '--out', staging,
], { stdio: 'inherit' });

fs.rmSync(proj, { recursive: true, force: true });
fs.mkdirSync(path.join(proj, 'images'), { recursive: true });
fs.mkdirSync(path.join(proj, 'output'), { recursive: true });

const total = anim.frames.length;
const pick = Array.from({ length: KEEP }, (_, i) => Math.round(i * total / KEEP));
pick.forEach((f, i) => fs.copyFileSync(
  path.join(staging, slug, `frame-${String(f + 1).padStart(4, '0')}.png`),
  path.join(proj, 'images', `f${i}.png`)));

// The packer requires a preview image, and Screen/@Bitmap is what it uses. Frame
// 0 rather than a black rectangle, so the thumbnail in the phone app shows the
// watchface instead of an empty screen.
fs.copyFileSync(path.join(proj, 'images', 'f0.png'), path.join(proj, 'images', 'preview.png'));
fs.rmSync(staging, { recursive: true, force: true });

const bitmapList = pick.map((_, i) => `(${i}):f${i}.png`).join('|');
const xml = `<?xml version="1.0" encoding="utf-8"?>
<FaceProject DeviceType="${deviceId}" Id="">
  <Screen Title="${anim.name}" Bitmap="preview.png">
    <Widget Shape="31" Name="anim" BitmapList="${bitmapList}" X="0" Y="0" Width="${device.w}" Height="${device.h}" Alpha="255" Alignment="0" DefaultIndex="0" Value_Src="${SECOND_LOW}" Spacing="0" Blanking="0" Visible_Src="0"/>
  </Screen>
</FaceProject>
`;
fs.writeFileSync(path.join(proj, `${slug}.fprj`), xml);

console.log(`\n${anim.name} → ${device.name} (${device.w}x${device.h})`);
console.log(`  ${KEEP} of ${total} frames: ${pick.join(', ')}`);
console.log(`  ${path.relative(process.cwd(), proj)}/${slug}.fprj`);
console.log(`  pack it with .github/workflows/build-watchface.yml`);
