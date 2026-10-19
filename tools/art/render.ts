/**
 * Renders the subject textures used by the dither layer.
 *
 *   node tools/art/render.ts                 all scenes + the promotion atlas -> public/art/
 *   node tools/art/render.ts hero mitre      only those scenes
 *   node tools/art/render.ts --scale 0.25 --preview <dir>
 *                                            quick low-resolution pass, plus composited previews
 *
 * Each output PNG is RGB: R = subject luminance, G = subject coverage, B = background luminance.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { encodePNG } from './png.ts';
import { renderScene, type Planes } from './raymarch.ts';
import { MORPH_COLS, MORPH_FRAMES, MORPH_H, MORPH_W, SCENES, morphScene, type Scene } from './scenes.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'public/art');

interface Job {
  id: string;
  scale: number;
}

function sceneFor(id: string, scale: number): Scene {
  const m = /^morph-(\d+)$/.exec(id);
  const s = m ? morphScene(Number(m[1])) : SCENES.find((x) => x.id === id);
  if (!s) throw new Error(`unknown scene ${id}`);
  return { ...s, width: Math.round(s.width * scale), height: Math.round(s.height * scale) };
}

function toRGB(p: Planes): Uint8Array {
  const out = new Uint8Array(p.width * p.height * 3);
  for (let i = 0; i < p.width * p.height; i++) {
    out[i * 3] = Math.round(Math.min(1, Math.max(0, p.subject[i]!)) * 255);
    out[i * 3 + 1] = Math.round(Math.min(1, Math.max(0, p.alpha[i]!)) * 255);
    out[i * 3 + 2] = Math.round(Math.min(1, Math.max(0, p.background[i]!)) * 255);
  }
  return out;
}

function composite(p: Planes): Uint8Array {
  const out = new Uint8Array(p.width * p.height);
  for (let i = 0; i < out.length; i++) {
    const a = p.alpha[i]!;
    out[i] = Math.round((p.subject[i]! * a + p.background[i]! * (1 - a)) * 255);
  }
  return out;
}

if (!isMainThread) {
  parentPort!.on('message', (job: Job | null) => {
    if (!job) {
      process.exit(0);
    }
    const t0 = performance.now();
    const planes = renderScene(sceneFor(job.id, job.scale));
    parentPort!.postMessage(
      { id: job.id, planes, ms: performance.now() - t0 },
      [planes.subject.buffer, planes.alpha.buffer, planes.background.buffer] as ArrayBuffer[]
    );
  });
} else {
  const args = process.argv.slice(2);
  let scale = 1;
  let preview: string | null = null;
  const ids: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--scale') scale = Number(args[++i]);
    else if (a === '--preview') preview = resolve(args[++i]!);
    else ids.push(a);
  }
  const sceneIds = ids.length ? ids.filter((x) => x !== 'morph') : SCENES.map((s) => s.id);
  const wantMorph = ids.length === 0 || ids.includes('morph');
  const morphIds = wantMorph ? Array.from({ length: MORPH_FRAMES }, (_, i) => `morph-${i}`) : [];
  const queue: Job[] = [...sceneIds, ...morphIds].map((id) => ({ id, scale }));
  const total = queue.length;
  mkdirSync(OUT, { recursive: true });
  if (preview) mkdirSync(preview, { recursive: true });

  const results = new Map<string, Planes>();
  const nWorkers = Math.max(1, Math.min(cpus().length, queue.length));
  let done = 0;
  const t0 = performance.now();

  await Promise.all(
    Array.from({ length: nWorkers }, async () => {
      const w = new Worker(fileURLToPath(import.meta.url));
      await new Promise<void>((resolveWorker, reject) => {
        const next = () => {
          const job = queue.shift();
          w.postMessage(job ?? null);
          if (!job) resolveWorker();
        };
        w.on('message', (msg: { id: string; planes: Planes; ms: number }) => {
          done++;
          results.set(msg.id, msg.planes);
          console.log(`[${done}/${total}] ${msg.id} ${(msg.ms / 1000).toFixed(1)}s`);
          if (!msg.id.startsWith('morph-')) {
            const p = msg.planes;
            writeFileSync(join(OUT, `${msg.id}.png`), encodePNG(p.width, p.height, toRGB(p), 2));
            if (preview) writeFileSync(join(preview, `${msg.id}.png`), encodePNG(p.width, p.height, composite(p), 0));
          }
          next();
        });
        w.on('error', reject);
        next();
      });
    })
  );

  if (wantMorph) {
    const fw = Math.round(MORPH_W * scale);
    const fh = Math.round(MORPH_H * scale);
    const rows = Math.ceil(MORPH_FRAMES / MORPH_COLS);
    const aw = fw * MORPH_COLS;
    const ah = fh * rows;
    const atlas = new Uint8Array(aw * ah * 3);
    for (let f = 0; f < MORPH_FRAMES; f++) {
      const p = results.get(`morph-${f}`)!;
      const rgb = toRGB(p);
      const ox = (f % MORPH_COLS) * fw;
      const oy = Math.floor(f / MORPH_COLS) * fh;
      for (let y = 0; y < fh; y++) {
        atlas.set(rgb.subarray(y * fw * 3, (y + 1) * fw * 3), ((oy + y) * aw + ox) * 3);
      }
    }
    writeFileSync(join(OUT, 'morph.png'), encodePNG(aw, ah, atlas, 2));
    if (preview) {
      const grey = new Uint8Array(aw * ah);
      for (let i = 0; i < aw * ah; i++) {
        const a = atlas[i * 3 + 1]! / 255;
        grey[i] = Math.round(atlas[i * 3]! * a + atlas[i * 3 + 2]! * (1 - a));
      }
      writeFileSync(join(preview, 'morph.png'), encodePNG(aw, ah, grey, 0));
    }
  }

  // Manifest: dimensions and focal points, merged with any scenes rendered earlier.
  const manifestPath = join(OUT, 'manifest.json');
  const manifest: {
    scenes: Record<string, { width: number; height: number; focal: [number, number] }>;
    morph?: { frames: number; cols: number; frameWidth: number; frameHeight: number };
  } = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { scenes: {} };
  for (const id of sceneIds) {
    const s = sceneFor(id, scale);
    manifest.scenes[id] = { width: s.width, height: s.height, focal: s.focal };
  }
  if (wantMorph) {
    manifest.morph = {
      frames: MORPH_FRAMES,
      cols: MORPH_COLS,
      frameWidth: Math.round(MORPH_W * scale),
      frameHeight: Math.round(MORPH_H * scale)
    };
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`done in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
}
