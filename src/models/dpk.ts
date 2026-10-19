/**
 * Reader for .dpk model packs (format in tools/models/src/dither_models/pack.py):
 * "DPK1", u32 LE header length, JSON header, then the files back to back.
 */
import { sha256Hex } from './sha256';

export interface DpkFile {
  name: string;
  offset: number;
  size: number;
  sha256: string;
}

export interface DpkHeader {
  id: string;
  version: string;
  family: 'fastelo' | 'maia3' | 'maia2';
  meta: Record<string, unknown>;
  files: DpkFile[];
}

export interface DpkSource {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export function blobSource(blob: Blob): DpkSource {
  return {
    size: blob.size,
    read: async (offset, length) => new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer())
  };
}

export function bytesSource(bytes: Uint8Array): DpkSource {
  return { size: bytes.length, read: async (o, n) => bytes.subarray(o, o + n) };
}

export class Dpk {
  private constructor(
    readonly header: DpkHeader,
    private readonly dataStart: number,
    private readonly src: DpkSource
  ) {}

  static async open(src: DpkSource): Promise<Dpk> {
    if (src.size < 8) throw new Error('not a model pack (too short)');
    const head = await src.read(0, 8);
    const magic = String.fromCharCode(head[0]!, head[1]!, head[2]!, head[3]!);
    if (magic !== 'DPK1') throw new Error('not a model pack (bad signature)');
    const len = new DataView(head.buffer, head.byteOffset, 8).getUint32(4, true);
    if (8 + len > src.size) throw new Error('model pack header is truncated');
    const header = JSON.parse(new TextDecoder().decode(await src.read(8, len))) as DpkHeader;
    if (!header.id || !Array.isArray(header.files)) throw new Error('model pack header is malformed');
    const dataStart = 8 + len;
    for (const f of header.files) {
      if (f.offset < 0 || dataStart + f.offset + f.size > src.size) throw new Error(`pack file ${f.name} is out of range`);
    }
    return new Dpk(header, dataStart, src);
  }

  has(name: string): boolean {
    return this.header.files.some((f) => f.name === name);
  }

  /** Read one file and check it against the checksum recorded in the header. */
  async file(name: string): Promise<Uint8Array> {
    const f = this.header.files.find((x) => x.name === name);
    if (!f) throw new Error(`pack ${this.header.id} has no ${name}`);
    const bytes = await this.src.read(this.dataStart + f.offset, f.size);
    if (sha256Hex(bytes) !== f.sha256) throw new Error(`${this.header.id}/${name} is damaged (checksum mismatch)`);
    return bytes;
  }

  async json<T>(name: string): Promise<T> {
    return JSON.parse(new TextDecoder().decode(await this.file(name))) as T;
  }
}
