/** Set at build time by vite.config.ts. */

/**
 * Pack files the website installs by itself from its own server on the first visit
 * (DITHER_PREINSTALL=all or a list of pack ids). Empty for builds where the player installs packs.
 */
declare const __DITHER_PREINSTALL__: string[];

/**
 * Path, relative to the app, of the source archive served with this build
 * (DITHER_SOURCE_ARCHIVE=1), or null when the build carries none.
 */
declare const __DITHER_SOURCE__: string | null;
