/** Minimal PNG encoder/decoder for 8-bit RGB / RGBA / greyscale images (no interlace). */
import { deflateSync, inflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const CHANNELS = { 0: 1, 2: 3, 6: 4 } as const;
export type ColorType = keyof typeof CHANNELS;

export function encodePNG(width: number, height: number, pixels: Uint8Array, colorType: ColorType): Buffer {
  const ch = CHANNELS[colorType];
  if (pixels.length !== width * height * ch) throw new Error('pixel buffer size mismatch');
  const stride = width * ch;
  // Filter each row with the Paeth/Sub/Up/None filter that minimises the absolute sum.
  const raw = Buffer.alloc((stride + 1) * height);
  const cand = [0, 1, 2, 4].map(() => Buffer.alloc(stride));
  for (let y = 0; y < height; y++) {
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    let best = 0;
    let bestScore = Infinity;
    [0, 1, 2, 4].forEach((f, k) => {
      const out = cand[k]!;
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const a = x >= ch ? row[x - ch]! : 0;
        const b = prev ? prev[x]! : 0;
        const c = prev && x >= ch ? prev[x - ch]! : 0;
        let pred = 0;
        if (f === 1) pred = a;
        else if (f === 2) pred = b;
        else if (f === 4) {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        const v = (row[x]! - pred) & 0xff;
        out[x] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) {
        bestScore = score;
        best = k;
      }
    });
    raw[y * (stride + 1)] = [0, 1, 2, 4][best]!;
    cand[best]!.copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0))
  ]);
}

export function decodePNG(buf: Buffer): { width: number; height: number; channels: number; pixels: Uint8Array } {
  let p = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9]!;
    } else if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const ch = CHANNELS[colorType as ColorType];
  const stride = width * ch;
  const raw = inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]!;
      const a = x >= ch ? out[y * stride + x - ch]! : 0;
      const b = y > 0 ? out[(y - 1) * stride + x]! : 0;
      const c = y > 0 && x >= ch ? out[(y - 1) * stride + x - ch]! : 0;
      let pred = 0;
      if (f === 1) pred = a;
      else if (f === 2) pred = b;
      else if (f === 3) pred = (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = (v + pred) & 0xff;
    }
  }
  return { width, height, channels: ch, pixels: out };
}
