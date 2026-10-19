/**
 * models/manifest.json, written by tools/models (`dither-models pack`): one entry per model pack
 * with its checksum, size, licence, upstream revision and calibrated levels.
 */
import raw from '../../models/manifest.json';
import type { ModelFamily } from './catalog';

export interface ManifestPack {
  id: string;
  version: string;
  family: ModelFamily;
  title: string;
  file: string;
  sha256: string;
  size: number;
  license: string;
  source: Record<string, string>;
  variant: string;
  optional: boolean;
  calibration: { method: string; levels: number[] };
}

export interface Manifest {
  format: number;
  /** Download URL prefixes, tried in order. Relative entries resolve against the app's URL. */
  sources: string[];
  packs: ManifestPack[];
}

export const MANIFEST = raw as unknown as Manifest;

export function packById(id: string): ManifestPack | undefined {
  return MANIFEST.packs.find((p) => p.id === id);
}

export function packForChecksum(sha256: string): ManifestPack | undefined {
  return MANIFEST.packs.find((p) => p.sha256 === sha256.toLowerCase());
}

/** Default pack per family: the non-optional one. */
export function defaultPack(family: ModelFamily): ManifestPack | undefined {
  return MANIFEST.packs.find((p) => p.family === family && !p.optional) ?? MANIFEST.packs.find((p) => p.family === family);
}

export function resolveSource(base: string, file: string, appBase: string = import.meta.env.BASE_URL): string {
  const prefix = /^[a-z]+:\/\//i.test(base) ? base : new URL(base, new URL(appBase, globalThis.location?.href)).href;
  return prefix.endsWith('/') ? prefix + file : `${prefix}/${file}`;
}
