import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';

const size = 128;
const rows = [];
for (let y = 0; y < size; y += 1) {
  const row = Buffer.alloc(1 + size * 4);
  for (let x = 0; x < size; x += 1) {
    const offset = 1 + x * 4;
    const line = Math.abs(x - y) < 4 || Math.abs(x + y - 127) < 4;
    const node = [[32, 32], [96, 32], [64, 94]].some(([cx, cy]) => (x - cx) ** 2 + (y - cy) ** 2 < 13 ** 2);
    row[offset] = node ? 90 : line ? 38 : 14;
    row[offset + 1] = node ? 220 : line ? 145 : 24;
    row[offset + 2] = node ? 255 : line ? 190 : 40;
    row[offset + 3] = 255;
  }
  rows.push(row);
}

await mkdir(new URL('../assets/', import.meta.url), { recursive: true });
await writeFile(new URL('../assets/icon.png', import.meta.url), Buffer.concat([
  signature(),
  chunk('IHDR', Buffer.from([0, 0, 0, size, 0, 0, 0, size, 8, 6, 0, 0, 0])),
  chunk('IDAT', deflateSync(Buffer.concat(rows))),
  chunk('IEND', Buffer.alloc(0))
]));

function signature() {
  return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
}

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
