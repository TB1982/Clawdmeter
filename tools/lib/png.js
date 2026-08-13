/**
 * Minimal RGB PNG writer.
 *
 * Extracted from make_custom_anims.js so preview_anim.js doesn't carry a second
 * copy: two encoders that must agree pixel-for-pixel is exactly the kind of
 * duplicate that drifts silently, and a preview that disagrees with the other
 * preview is worse than no preview.
 *
 * 8-bit truecolour, no alpha, no interlacing — everything here renders onto an
 * opaque background because the device panel is opaque.
 */

const fs = require('fs');
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// Colour type 2 is truecolour, 6 is truecolour with alpha. Everything else in
// the header is identical, so both writers share this.
function writePng(file, W, H, img, channels, colourType) {
  const stride = W * channels;
  const raw = Buffer.alloc((stride + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (stride + 1)] = 0;                    // filter type 0 (None)
    img.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;              // bit depth
  ihdr[9] = colourType;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

/**
 * @param {string} file  destination path
 * @param {number} W     width in pixels
 * @param {number} H     height in pixels
 * @param {Buffer} img   W*H*3 bytes, RGB, row-major
 */
function writeRgbPng(file, W, H, img) {
  writePng(file, W, H, img, 3, 2);
}

/**
 * Same, with an alpha channel. Needed because Xiaomi's watchface packer only
 * accepts 32-bit PNGs: hand it a 24-bit one and it neither converts nor
 * complains — it packs something the watch cannot decode, and the failure only
 * surfaces on unpacking as "image len 16773, but expected 645120" (that being
 * 336*480*4). Every known-good sample project is colour type 6.
 *
 * @param {Buffer} img   W*H*4 bytes, RGBA, row-major
 */
function writeRgbaPng(file, W, H, img) {
  writePng(file, W, H, img, 4, 6);
}

module.exports = { writeRgbPng, writeRgbaPng };
