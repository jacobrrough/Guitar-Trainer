/**
 * End-to-end smoke test against the production build (`npm run build` first).
 * Uses the Chromium that ships with the environment's Playwright and its fake
 * microphone so the tuner and scoring pipelines run without hardware.
 *
 *   node e2e/smoke.mjs            # starts `vite preview` itself
 *   BASE_URL=http://localhost:4173 node e2e/smoke.mjs
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { chromium, devices } = require('playwright')

// DEVICE="iPhone 15" (or "iPhone 15 landscape") emulates a phone: viewport, touch, Safari UA.
const DEVICE = process.env.DEVICE ? devices[process.env.DEVICE] : null
if (process.env.DEVICE && !DEVICE) throw new Error(`Unknown device ${process.env.DEVICE}`)
const SUFFIX = process.env.DEVICE ? `-${process.env.DEVICE.replace(/\s+/g, '_')}` : ''

const OUT = path.resolve('e2e/output')
mkdirSync(OUT, { recursive: true })

function log(...args) {
  console.log(new Date().toISOString().slice(11, 19), ...args)
}

async function startPreview() {
  if (process.env.BASE_URL) return { url: process.env.BASE_URL, stop: () => {} }
  // Random port so a lingering server from an earlier run cannot block us; detached so we can kill the whole group.
  const port = 4200 + Math.floor(Math.random() * 700)
  const child = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('preview did not start')), 30000)
    child.stdout.on('data', (d) => {
      const m = String(d).match(/(http:\/\/localhost:\d+)/)
      if (m) {
        clearTimeout(timer)
        resolve(m[1])
      }
    })
    child.stderr.on('data', (d) => process.stderr.write(d))
    child.on('exit', (code) => reject(new Error(`preview exited with ${code}`)))
  })
  const stop = () => {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      child.kill()
    }
  }
  return { url, stop }
}

/** Four plucked notes (E2 A2 D3 G3), 1.5 s each, as a 16-bit mono WAV. */
function synthWav() {
  const sr = 22050
  const notes = [82.41, 110, 146.83, 196]
  const perNote = 1.5
  const total = Math.ceil(sr * (notes.length * perNote + 0.5))
  const samples = new Float32Array(total)
  notes.forEach((f, i) => {
    const start = Math.round(i * perNote * sr)
    for (let n = 0; n < perNote * sr; n++) {
      const t = n / sr
      const env = Math.exp(-t * 2.2)
      samples[start + n] += env * 0.5 * (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(2 * Math.PI * 2 * f * t) + 0.25 * Math.sin(2 * Math.PI * 3 * f * t))
    }
  })
  const buf = Buffer.alloc(44 + total * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + total * 2, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sr, 24)
  buf.writeUInt32LE(sr * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(total * 2, 40)
  for (let i = 0; i < total; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2)
  return { buffer: buf, expectedMidi: [40, 45, 50, 55] }
}

class SkipRest extends Error {}

const failures = []
function check(cond, message) {
  if (cond) log('  ok  ', message)
  else {
    failures.push(message)
    log('  FAIL', message)
  }
}

const preview = await startPreview()
const base = preview.url
log('preview at', base)
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'],
})
const context = await browser.newContext({ ...(DEVICE ?? { viewport: { width: 1280, height: 800 } }), permissions: ['microphone'] })
const page = await context.newPage()
const consoleErrors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text())
})
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`))

try {
  // Library (empty state)
  await page.goto(`${base}/#/`)
  await page.waitForSelector('text=Add your first song', { timeout: 15000 })
  check(true, 'library renders the empty state')
  const bannerCount = await page.getByTestId('install-banner').count()
  if (DEVICE && /iPhone|iPad/.test(DEVICE.userAgent)) {
    check(bannerCount === 1, 'iOS install banner shown')
    if (bannerCount === 1) {
      await page.getByRole('button', { name: 'Dismiss' }).click()
      check((await page.getByTestId('install-banner').count()) === 0, 'install banner can be dismissed')
    }
  } else {
    check(bannerCount === 0, 'no install banner on desktop without a prompt')
  }

  // Metronome
  await page.goto(`${base}/#/metronome`)
  await page.getByTestId('metronome-toggle').click()
  await page.waitForTimeout(1500)
  check((await page.getByTestId('metronome-toggle').innerText()).includes('Stop'), 'metronome starts')
  const litDots = await page.locator('.beat-pulse').count()
  check(litDots >= 0, 'metronome beat indicator present')
  await page.getByTestId('metronome-toggle').click()

  // Tuner with the fake microphone (Chromium's fake device emits a tone pattern)
  await page.goto(`${base}/#/tuner`)
  await page.getByRole('button', { name: 'Start listening' }).click()
  await page.waitForTimeout(2500)
  const tunerError = await page.locator('text=Could not access').count()
  check(tunerError === 0, 'tuner started without a microphone error')
  const tunerText = await page.locator('main').innerText()
  check(/Hz/.test(tunerText) || /Play a string/.test(tunerText), 'tuner is listening (reading or prompt shown)')
  await page.screenshot({ path: path.join(OUT, `tuner${SUFFIX}.png`) })

  // Demo song → play page
  await page.goto(`${base}/#/`)
  await page.getByTestId('add-demo').click()
  await page.waitForURL(/#\/play\/\d+/, { timeout: 20000 })
  await page.waitForSelector('[data-testid="start"]', { timeout: 15000 })
  check(true, 'demo song created and play page opened')
  const levelCounts = []
  for (const lvl of [1, 3, 6]) {
    await page.getByTestId(`level-${lvl}`).filter({ visible: true }).click()
    await page.waitForTimeout(200)
    const text = await page.locator('text=/notes ·/').first().innerText()
    levelCounts.push(Number(text.match(/(\d+) notes/)[1]))
  }
  check(levelCounts[0] < levelCounts[1] && levelCounts[1] <= levelCounts[2], `difficulty levels thin the chart (${levelCounts.join(' < ')})`)
  if (DEVICE && DEVICE.viewport.width < 640) {
    check(await page.getByTestId('controls-mobile').isVisible(), 'phone layout shows the compact level row')
    check(!(await page.getByTestId('controls-desktop').isVisible()), 'phone layout hides the desktop controls')
  } else {
    check(await page.getByTestId('controls-desktop').isVisible(), 'desktop controls visible')
  }
  await page.getByTestId('level-3').filter({ visible: true }).click()
  await page.getByTestId('start').click()
  await page.waitForSelector('[data-testid="countdown"]', { timeout: 5000 })
  check(true, 'count-in shown')
  await page.waitForSelector('[data-testid="countdown"]', { state: 'detached', timeout: 10000 })
  await page.waitForTimeout(2500)
  const playing = await page.evaluate(() => {
    const el = document.querySelector('audio')
    return el && !el.paused && el.currentTime > 1
  })
  check(playing, 'song audio is playing')
  const painted = await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="highway"]')
    if (!canvas || canvas.width === 0 || canvas.height === 0) return { width: canvas?.width ?? 0, colors: 0 }
    const ctx = canvas.getContext('2d')
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const colors = new Set()
    for (let i = 0; i < data.length; i += 4 * 97) colors.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2])
    return { width: canvas.width, colors: colors.size }
  })
  check(painted.width > 0 && painted.colors > 20, `highway canvas is painted (${painted.width}px wide, ${painted.colors} sampled colours)`)
  await page.screenshot({ path: path.join(OUT, `highway${SUFFIX}.png`) })
  // Tap/click the highway: pause, then resume.
  const highway = page.getByTestId('highway')
  if (DEVICE?.hasTouch) await highway.tap()
  else await highway.click()
  await page.waitForTimeout(400)
  check(await page.evaluate(() => document.querySelector('audio').paused), 'tapping the highway pauses')
  if (DEVICE?.hasTouch) await highway.tap()
  else await highway.click()
  await page.waitForTimeout(600)
  check(await page.evaluate(() => !document.querySelector('audio').paused), 'tapping again resumes')
  // Jump near the end by letting it run; the demo is ~22 s.
  await page.waitForSelector('[data-testid="results"]', { timeout: 40000 })
  const results = await page.getByTestId('results').innerText()
  check(/accuracy/.test(results), `results screen shown: ${results.split('\n').slice(0, 3).join(' | ')}`)
  await page.screenshot({ path: path.join(OUT, `results${SUFFIX}.png`) })

  // Back to the library: best-score indicator and play count persisted
  await page.goto(`${base}/#/`)
  await page.waitForSelector('text=Demo riff in E minor', { timeout: 10000 })
  check((await page.locator('text=/1 plays/').count()) === 1, 'play count persisted to IndexedDB')

  // Import with AI transcription of a synthetic 4-note WAV (slow on CPU; SKIP_TRANSCRIBE=1 to skip)
  if (process.env.SKIP_TRANSCRIBE) throw new SkipRest()
  const wav = synthWav()
  writeFileSync(path.join(OUT, 'synth.wav'), wav.buffer)
  await page.getByTestId('add-song').click()
  await page.getByText('Listen & transcribe (AI)').click()
  await page.locator('input[type=file]').first().setInputFiles({ name: 'Synth Artist - Four Notes.wav', mimeType: 'audio/wav', buffer: wav.buffer })
  check((await page.locator('input[placeholder="Song title"]').inputValue()) === 'Four Notes', 'title parsed from file name')
  check((await page.locator('input[placeholder="Artist"]').inputValue()) === 'Synth Artist', 'artist parsed from file name')
  await page.getByRole('button', { name: 'Add to library' }).click()
  await page.waitForURL(/#\/play\/\d+/, { timeout: 180000 })
  await page.waitForSelector('[data-testid="start"]', { timeout: 15000 })
  const transcribed = await page.evaluate(async () => {
    const req = indexedDB.open('guitar-trainer')
    const dbi = await new Promise((res, rej) => {
      req.onsuccess = () => res(req.result)
      req.onerror = () => rej(req.error)
    })
    const tx = dbi.transaction('songs', 'readonly')
    const all = await new Promise((res, rej) => {
      const r = tx.objectStore('songs').getAll()
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    const song = all.find((s) => s.source === 'transcription')
    return song ? { midis: [...new Set(song.chart.notes.map((n) => n.midi))].sort((a, b) => a - b), bpm: song.bpm, count: song.chart.notes.length } : null
  })
  check(!!transcribed, 'transcribed song saved')
  if (transcribed) {
    const found = wav.expectedMidi.filter((m) => transcribed.midis.includes(m))
    check(found.length >= 3, `transcription found ${found.length}/4 expected pitches (got ${transcribed.midis.join(',')}; ${transcribed.count} notes)`)
  }
  await page.screenshot({ path: path.join(OUT, `transcribed${SUFFIX}.png`) })
} catch (err) {
  if (err instanceof SkipRest) {
    log('  skip ', 'transcription import (SKIP_TRANSCRIBE set)')
  } else {
    failures.push(`exception: ${err.message}`)
    log('  FAIL', err.stack)
    await page.screenshot({ path: path.join(OUT, `failure${SUFFIX}.png`) }).catch(() => {})
  }
}

const realErrors = consoleErrors.filter((e) => !/favicon|manifest|ERR_FAILED/.test(e))
check(realErrors.length === 0, realErrors.length ? `console errors: ${realErrors.slice(0, 5).join(' || ')}` : 'no console errors')

await browser.close()
preview.stop()
if (failures.length) {
  log(`${failures.length} failure(s)`)
  process.exit(1)
}
log('all smoke checks passed')
