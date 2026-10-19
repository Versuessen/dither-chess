import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Sha256, sha256Hex } from '../../src/models/sha256';
import { Dpk, bytesSource, blobSource } from '../../src/models/dpk';
import { MANIFEST, packById, packForChecksum, resolveSource } from '../../src/models/manifest';

const enc = new TextEncoder();
const nodeSha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

describe('sha256', () => {
  // FIPS 180-4 / NIST CAVP example vectors.
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
    ],
    [
      'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
      'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1'
    ]
  ])('hashes %j', (msg, hex) => {
    expect(sha256Hex(enc.encode(msg))).toBe(hex);
  });

  it('hashes one million "a" fed in uneven chunks', () => {
    const h = new Sha256();
    const chunk = new Uint8Array(997).fill(0x61);
    let left = 1_000_000;
    while (left > 0) {
      const n = Math.min(left, chunk.length);
      h.update(chunk.subarray(0, n));
      left -= n;
    }
    expect(h.hex()).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });

  it('matches node:crypto at every padding boundary and any chunking', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 8) & 0xff;
    for (let len = 0; len <= 200; len++) {
      const data = Uint8Array.from({ length: len }, rand);
      const h = new Sha256();
      for (let i = 0; i < len; ) {
        const n = 1 + (rand() % 70);
        h.update(data.subarray(i, i + n));
        i += n;
      }
      expect(h.hex(), `length ${len}`).toBe(nodeSha(data));
    }
  });

  it('refuses updates after the digest', () => {
    const h = new Sha256().update(enc.encode('x'));
    h.digest();
    expect(() => h.update(enc.encode('y'))).toThrow();
    expect(h.hex()).toBe(nodeSha(enc.encode('x')));
  });
});

/** Build a pack the same way tools/models/src/dither_models/pack.py does. */
function buildPack(files: Record<string, Uint8Array>, id = 'test-pack'): Uint8Array {
  let offset = 0;
  const entries = Object.entries(files).map(([name, bytes]) => {
    const e = { name, offset, size: bytes.length, sha256: nodeSha(bytes) };
    offset += bytes.length;
    return e;
  });
  const header = enc.encode(JSON.stringify({ id, version: '1', family: 'maia3', meta: {}, files: entries }));
  const out = new Uint8Array(8 + header.length + offset);
  out.set(enc.encode('DPK1'), 0);
  new DataView(out.buffer).setUint32(4, header.length, true);
  out.set(header, 8);
  let at = 8 + header.length;
  for (const bytes of Object.values(files)) {
    out.set(bytes, at);
    at += bytes.length;
  }
  return out;
}

describe('dpk', () => {
  const files = {
    'model.onnx': Uint8Array.from({ length: 5000 }, (_, i) => (i * 31) & 0xff),
    'vocab.json': enc.encode(JSON.stringify(['e2e4', 'd2d4'])),
    'calibration.json': enc.encode(JSON.stringify({ knots: [1, 2] }))
  };

  it('reads files and JSON from bytes and from a Blob', async () => {
    const bytes = buildPack(files);
    for (const src of [bytesSource(bytes), blobSource(new Blob([bytes as BlobPart]))]) {
      const pack = await Dpk.open(src);
      expect(pack.header.id).toBe('test-pack');
      expect(pack.has('vocab.json')).toBe(true);
      expect(pack.has('missing')).toBe(false);
      expect(Array.from(await pack.file('model.onnx'))).toEqual(Array.from(files['model.onnx']));
      expect(await pack.json<string[]>('vocab.json')).toEqual(['e2e4', 'd2d4']);
      await expect(pack.file('missing')).rejects.toThrow(/has no missing/);
    }
  });

  it('rejects a damaged file', async () => {
    const bytes = buildPack(files);
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff; // last byte belongs to calibration.json
    const pack = await Dpk.open(bytesSource(bytes));
    await expect(pack.json('calibration.json')).rejects.toThrow(/damaged/);
    expect((await pack.file('model.onnx')).length).toBe(5000);
  });

  it('rejects foreign or truncated files', async () => {
    await expect(Dpk.open(bytesSource(enc.encode('PK\u0003\u0004 not a pack')))).rejects.toThrow(/signature/);
    await expect(Dpk.open(bytesSource(new Uint8Array(4)))).rejects.toThrow(/too short/);
    const bytes = buildPack(files);
    await expect(Dpk.open(bytesSource(bytes.subarray(0, 40)))).rejects.toThrow(/truncated/);
    await expect(Dpk.open(bytesSource(bytes.subarray(0, bytes.length - 10)))).rejects.toThrow(/out of range/);
  });
});

describe('manifest', () => {
  it('lists every pack with a checksum, size, licence and source revision', () => {
    expect(MANIFEST.packs.length).toBeGreaterThan(0);
    for (const p of MANIFEST.packs) {
      expect(p.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(p.size).toBeGreaterThan(0);
      expect(p.license.length).toBeGreaterThan(0);
      expect(Object.values(p.source).join('')).toMatch(/[0-9a-f]{7,}/);
      expect(packById(p.id)).toBe(p);
      expect(packForChecksum(p.sha256)).toBe(p);
    }
  });

  it('resolves download URLs against the configured sources', () => {
    const p = MANIFEST.packs[0]!;
    expect(resolveSource('https://example.org/releases/', p.file)).toBe(`https://example.org/releases/${p.file}`);
    expect(resolveSource('https://example.org/releases', p.file)).toBe(`https://example.org/releases/${p.file}`);
    expect(resolveSource('models/packs/', p.file, 'https://dither.test/app/')).toBe(`https://dither.test/app/models/packs/${p.file}`);
  });
});
