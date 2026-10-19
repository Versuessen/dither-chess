import { chromium } from '@playwright/test';
const out = process.argv[2];
const b = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const [name, w, h, hash, mobile] of [['home', 1440, 900, '', false], ['home-mobile', 390, 844, '', true]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  await p.goto('http://localhost:4173/' + hash);
  await p.waitForTimeout(6000);
  await p.screenshot({ path: `${out}/${name}.png` });
  await p.close();
}
await b.close();
