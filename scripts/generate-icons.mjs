// HydraDAW — generador de iconos PWA (CFG-01).
//
// `npm run icons` regenera `public/icons/*.png`. PNG reales escritos a mano
// con solo la librería estándar de Node (`zlib`): sin dependencias y sin
// blobs binarios de procedencia desconocida.
//
// Marca: anillo cian (#06b6d4) con nodo central sobre fondo oscuro (#0a0d14).
// La variante maskable deja zona segura (arte dentro del 60% central).

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'icons');

const BG = [10, 13, 20, 255];
const CYAN = [6, 182, 212, 255];

const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length, 0);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head, body, tail]);
}

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0; // filtro None por scanline
    pixels.copy(raw, y * (1 + size * 4) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function drawIcon(size, maskable) {
  const pixels = Buffer.alloc(size * size * 4);
  const center = (size - 1) / 2;
  const outer = maskable ? 0.3 : 0.36;
  const inner = maskable ? 0.215 : 0.265;
  const dot = maskable ? 0.07 : 0.085;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - center) / size;
      const dy = (y - center) / size;
      const d = Math.sqrt(dx * dx + dy * dy);
      const on = (d <= outer && d >= inner) || d <= dot;
      const [r, g, b, a] = on ? CYAN : BG;
      const o = (y * size + x) * 4;
      pixels[o] = r;
      pixels[o + 1] = g;
      pixels[o + 2] = b;
      pixels[o + 3] = a;
    }
  }
  return encodePng(size, pixels);
}

mkdirSync(OUT_DIR, { recursive: true });
const targets = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-512-maskable.png', size: 512, maskable: true },
];
for (const t of targets) {
  const png = drawIcon(t.size, t.maskable);
  writeFileSync(join(OUT_DIR, t.file), png);
  console.log(`${t.file}: ${t.size}x${t.size}, ${png.length} bytes`);
}
