/** The rendered subject textures (tools/art) and where they are served from. */
import raw from '../../public/art/manifest.json';
import type { ArtManifest } from './renderer';

export const ART: ArtManifest = raw as unknown as ArtManifest;
export const ART_BASE = `${import.meta.env.BASE_URL}art/`;
