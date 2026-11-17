"use strict";
// Minimaler PNG-Encoder für Graubilder (für die Übergabe an die Texterkennung)
const zlib = require("zlib");

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
// dpi: wird als pHYs gespeichert, damit Tesseract eine sinnvolle Auflösung annimmt (A4 1654 px ≈ 200 dpi)
function encodeGray(img, dpi = 200) {
  const { w, h, d } = img;
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; Buffer.from(d.buffer, d.byteOffset + y * w, w).copy(raw, y * (w + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const phys = Buffer.alloc(9); const ppm = Math.round(dpi / 0.0254); phys.writeUInt32BE(ppm, 0); phys.writeUInt32BE(ppm, 4); phys[8] = 1;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("pHYs", phys), chunk("IDAT", zlib.deflateSync(raw, { level: 3 })), chunk("IEND", Buffer.alloc(0))]);
}

// EXIF-Ausrichtung eines JPEG lesen (1 = normal, 3 = 180°, 6 = 90° rechts, 8 = 90° links)
function jpegOrientation(buf) {
  if (!buf || buf[0] !== 0xff || buf[1] !== 0xd8) return 1;
  let i = 2;
  while (i + 4 < buf.length) {
    if (buf[i] !== 0xff) return 1;
    const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
    if (m === 0xe1 && buf.toString("ascii", i + 4, i + 8) === "Exif") {
      const t = i + 10, le = buf.toString("ascii", t, t + 2) === "II";
      const r16 = o => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o)), r32 = o => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
      const ifd = t + r32(t + 4), n = r16(ifd);
      for (let k = 0; k < n; k++) { const e = ifd + 2 + k * 12; if (r16(e) === 0x0112) return r16(e + 8); }
      return 1;
    }
    if (m === 0xda) return 1;
    i += 2 + len;
  }
  return 1;
}
const orientationToDeg = o => ({ 3: 180, 6: 90, 8: 270 })[o] || 0;

module.exports = { encodeGray, jpegOrientation, orientationToDeg };
