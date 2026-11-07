/**
 * Renders public/icons/icon.svg to the PNG sizes iOS and the web manifest need,
 * using the Chromium bundled with Playwright (no native image libraries required).
 *
 *   node scripts/make-icons.mjs
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const svg = readFileSync(path.join(ROOT, 'public/icons/icon.svg'), 'utf8')

// padding = fraction of the canvas kept as solid background around the artwork.
const TARGETS = [
  { file: 'icon-192.png', size: 192, padding: 0 },
  { file: 'icon-512.png', size: 512, padding: 0 },
  { file: 'icon-maskable-512.png', size: 512, padding: 0.1 },
  { file: 'apple-touch-icon.png', size: 180, padding: 0 },
]

const browser = await chromium.launch()
const page = await browser.newPage()
for (const t of TARGETS) {
  const inner = Math.round(t.size * (1 - 2 * t.padding))
  await page.setViewportSize({ width: t.size, height: t.size })
  await page.setContent(
    `<html><body style="margin:0;width:${t.size}px;height:${t.size}px;background:#0b0f17;display:flex;align-items:center;justify-content:center;overflow:hidden">
       <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div>
     </body></html>`,
  )
  await page.screenshot({ path: path.join(ROOT, 'public/icons', t.file), clip: { x: 0, y: 0, width: t.size, height: t.size } })
  console.log('wrote', t.file)
}
await browser.close()
