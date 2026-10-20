import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { OpfsStore } from '../../src/models/opfs';
import type { ManifestPack } from '../../src/models/manifest';

/**
 * A small in-memory Origin Private File System. `move` follows WebKit's IDL, which has only
 * move(destination, newName) and rejects one argument with "Not enough arguments", as Safari
 * on iPhones does.
 */
class FakeFile {
  constructor(
    public name: string,
    public data: Uint8Array = new Uint8Array(0)
  ) {}
}

class FakeDir {
  files = new Map<string, FakeFile>();
  dirs = new Map<string, FakeDir>();

  async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
    let d = this.dirs.get(name);
    if (!d) {
      if (!opts?.create) throw new DOMException('not found', 'NotFoundError');
      d = new FakeDir();
      this.dirs.set(name, d);
    }
    return d;
  }

  async getFileHandle(name: string, opts?: { create?: boolean }) {
    let f = this.files.get(name);
    if (!f) {
      if (!opts?.create) throw new DOMException('not found', 'NotFoundError');
      f = new FakeFile(name);
      this.files.set(name, f);
    }
    return new FakeFileHandle(this, f);
  }

  async removeEntry(name: string) {
    if (!this.files.delete(name)) throw new DOMException('not found', 'NotFoundError');
  }
}

class FakeFileHandle {
  constructor(
    private dir: FakeDir,
    private file: FakeFile
  ) {}

  async getFile() {
    return new File([this.file.data as Uint8Array<ArrayBuffer>], this.file.name);
  }

  async createWritable(opts?: { keepExistingData?: boolean }) {
    const file = this.file;
    let buf = opts?.keepExistingData ? file.data.slice() : new Uint8Array(0);
    let pos = 0;
    return {
      async seek(p: number) {
        pos = p;
      },
      async truncate(n: number) {
        buf = buf.slice(0, n);
        pos = Math.min(pos, n);
      },
      async write(chunk: Uint8Array | ArrayBuffer | Blob | string) {
        const bytes =
          typeof chunk === 'string'
            ? new TextEncoder().encode(chunk)
            : chunk instanceof Blob
              ? new Uint8Array(await chunk.arrayBuffer())
              : new Uint8Array(chunk instanceof ArrayBuffer ? chunk : chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength));
        const next = new Uint8Array(Math.max(buf.length, pos + bytes.length));
        next.set(buf);
        next.set(bytes, pos);
        buf = next;
        pos += bytes.length;
      },
      async close() {
        file.data = buf;
      }
    };
  }

  // WebKit: Promise<undefined> move(FileSystemHandle destination, USVString newName);
  async move(...args: unknown[]) {
    if (args.length < 2) throw new TypeError('Not enough arguments');
    const [dest, name] = args as [FakeDir, string];
    this.dir.files.delete(this.file.name);
    this.file.name = name;
    dest.files.set(name, this.file);
  }
}

describe('OPFS model store', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('installs a pack on WebKit, whose move() needs the directory and the name', async () => {
    const root = new FakeDir();
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } });
    const bytes = new Uint8Array(70_000).map((_, i) => (i * 31) % 251);
    vi.stubGlobal('fetch', async () => new Response(bytes, { status: 200 }));
    const pack = {
      id: 'test',
      version: '1',
      family: 'maia3',
      title: 'Test pack',
      file: 'test-1.dpk',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length,
      license: 'CC0',
      source: {},
      variant: 'int8',
      optional: false,
      calibration: { method: 'none', levels: [] }
    } as ManifestPack;

    const store = new OpfsStore();
    const stored = await store.install(pack, ['https://example.test/test-1.dpk'], () => undefined, new AbortController().signal);
    expect(stored.id).toBe('test');
    const models = root.dirs.get('models')!;
    expect([...models.files.keys()].sort()).toEqual(['index.json', 'test-1.dpk']);
    expect(models.files.get('test-1.dpk')!.data).toEqual(bytes);
    expect(await store.list()).toHaveLength(1);
  });
});
