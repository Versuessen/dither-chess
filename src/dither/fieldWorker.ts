/** Builds the live scenes' distance-field atlas (fields.ts) off the main thread. */
import { buildFieldAtlas } from './fields';

self.onmessage = () => {
  const atlas = buildFieldAtlas();
  (self as unknown as Worker).postMessage(atlas, [atlas.data.buffer]);
};
