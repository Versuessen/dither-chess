/** Where the app is running, and the browser features it depends on. */

export type Platform = 'tauri' | 'web';

export function platform(): Platform {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window ? 'tauri' : 'web';
}

/**
 * True when SharedArrayBuffer (and so WASM threads) is usable: the page is cross-origin isolated
 * and the engine actually exposes SharedArrayBuffer (WebKitGTK reports isolation over HTTP but
 * ships without it, and never isolates Tauri's custom scheme).
 */
export function isCrossOriginIsolated(): boolean {
  return (
    typeof globalThis.crossOriginIsolated === 'boolean' && globalThis.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined'
  );
}

const RELOAD_FLAG = 'dither.coi-reload';

/**
 * Register the service worker on the web build. The first visit on a host that cannot send
 * COOP/COEP is not isolated yet; once the worker controls the page, reload once so it is.
 */
export async function registerServiceWorker(): Promise<void> {
  if (platform() !== 'web' || !('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  try {
    const reg = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL });
    await navigator.serviceWorker.ready;
    if (!isCrossOriginIsolated()) {
      let reloaded = false;
      try {
        reloaded = sessionStorage.getItem(RELOAD_FLAG) === '1';
        sessionStorage.setItem(RELOAD_FLAG, '1');
      } catch {
        reloaded = true;
      }
      if (!reloaded && navigator.serviceWorker.controller) location.reload();
      else if (!reloaded) {
        navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
      }
    } else {
      try {
        sessionStorage.removeItem(RELOAD_FLAG);
      } catch {
        /* ignore */
      }
    }
    void reg.update().catch(() => undefined);
  } catch (err) {
    console.warn('Service worker not registered:', err);
  }
}
