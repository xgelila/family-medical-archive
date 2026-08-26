// 生成 PWA 图标（柔和 slate/cornflower 蓝圆角方块 + 白色医疗十字），零依赖，纯 Node 标准库。
// 用法：node scripts/gen-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'icons');
const BRAND = [90, 127, 168, 255]; // #5a7fa8 柔和 slate/cornflower 蓝

function crc32(buf) {
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type);
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size) {
  const radius = Math.round(size * 0.22);
  const half = size / 2;
  const barW = Math.max(4, Math.round(size * 0.16));
  const barH = Math.max(4, Math.round(size * 0.5));
  const pixels = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 圆角矩形判断：点到“收拢后的矩形”中心距离 <= r
      const cx = Math.min(Math.max(x, radius), size - 1 - radius);
      const cy = Math.min(Math.max(y, radius), size - 1 - radius);
      const inside = Math.hypot(x - cx, y - cy) <= radius;

      if (!inside) continue;

      const inCross =
        Math.abs(x - half) <= barW / 2 && Math.abs(y - half) <= barH / 2
          ? true
          : Math.abs(y - half) <= barW / 2 && Math.abs(x - half) <= barH / 2;

      const i = (y * size + x) * 4;
      if (inCross) {
        pixels[i] = 255;
        pixels[i + 1] = 255;
        pixels[i + 2] = 255;
        pixels[i + 3] = 255;
      } else {
        pixels[i] = BRAND[0];
        pixels[i + 1] = BRAND[1];
        pixels[i + 2] = BRAND[2];
        pixels[i + 3] = BRAND[3];
      }
    }
  }

  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    pixels.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'icon-192.png'), png(192));
writeFileSync(join(outDir, 'icon-512.png'), png(512));
console.log('已生成 public/icons/icon-192.png 与 icon-512.png');
