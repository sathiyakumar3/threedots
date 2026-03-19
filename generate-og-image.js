// Generates public/images/og-image.png from og-image.svg
// Run once: npm install puppeteer  then  node generate-og-image.js

const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  const svgPath = path.resolve(__dirname, 'public/images/og-image.svg');
  const outPath  = path.resolve(__dirname, 'public/images/og-image.png');

  const browser = await puppeteer.launch({ headless: 'new' });
  const page    = await browser.newPage();

  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  await page.goto('file://' + svgPath.replace(/\\/g, '/'));
  await page.screenshot({ path: outPath, type: 'png', clip: { x: 0, y: 0, width: 1200, height: 630 } });

  await browser.close();
  console.log('✓ Saved:', outPath);
})();
