/**
 * The virtual student: an end-to-end test of the one thing the app is for. A new learner goes through
 * the set-up, opens lesson 1 and plays, and the "playing" is a real recorded guitar fed into the app as
 * its microphone, in step with the song. The app has to hear it through its real audio worklet, score it
 * on screen and move the learner on. A wrong performance and silence must not pass.
 *
 *   node e2e/student.mjs                     builds the app, then runs
 *   SKIP_BUILD=1 node e2e/student.mjs        uses the build in dist/ (it must be from this very code)
 *   BASE_URL=http://localhost:4173 node e2e/student.mjs
 *
 * The performances are rendered by src/features/play/e2eFixtures.test.ts from the same charts the app
 * shows, on every run. The app under test has to be built from the same code: a build that is even one
 * chart correction older asks for a note the performance does not contain. Hence the build step.
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { chromium, devices } = require('playwright')

const DEVICE = process.env.DEVICE ? devices[process.env.DEVICE] : null
if (process.env.DEVICE && !DEVICE) throw new Error(`Unknown device ${process.env.DEVICE}`)
const SUFFIX = process.env.DEVICE ? `-${process.env.DEVICE.replace(/\s+/g, '_')}` : ''
const OUT = path.resolve('e2e/output')
const FIXTURES = path.join(OUT, 'fixtures')
mkdirSync(OUT, { recursive: true })

function log(...args) {
  console.log(new Date().toISOString().slice(11, 19), ...args)
}

const failures = []
function check(ok, message) {
  log(ok ? '  ok  ' : '  FAIL', message)
  if (!ok) failures.push(message)
}

function buildFixtures() {
  const run = spawnSync('npx', ['vitest', 'run', 'src/features/play/e2eFixtures.test.ts', 'src/features/settings/e2eCalibrationFixture.test.ts'], { env: { ...process.env, E2E_FIXTURES: FIXTURES }, encoding: 'utf8' })
  if (run.status !== 0) throw new Error(`could not render the performances:\n${run.stdout}\n${run.stderr}`)
  return JSON.parse(readFileSync(path.join(FIXTURES, 'index.json'), 'utf8'))
}

async function startPreview() {
  if (process.env.BASE_URL) return { url: process.env.BASE_URL, stop: () => {} }
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

/**
 * Runs in the page before the app: replaces the microphone with a stream we feed. `arm(url)` loads a
 * performance; it then plays whenever the app's song element plays, from the matching position, so the
 * student is "in time" the way a person following the highway is. `noodle(url)` plays freely (for the
 * set-up wizard's microphone check).
 */
function virtualMicrophone() {
  // The modelled device is a slow one (wireless headphones are in this range). That also gives the
  // rig time to watch the song's clock settle before the first note has to come out.
  const MODEL_DELAY = 0.25
  const HOLD = 0.9
  const SETTLE_FROM_MS = 150
  const SETTLE_MS = 250
  let ctx = null
  let out = null
  let armed = null
  let source = null
  let following = null
  const ensure = () => {
    if (ctx) return
    ctx = new AudioContext({ sampleRate: 48000 })
    // Sound takes time to get from the speaker to the player and back through the microphone. This
    // rig models a device where that takes about 270 ms (250 ms here plus about 20 ms of its own
    // path). The app is not told: the student runs "Sync your sound" and the app has to measure it.
    out = ctx.createDelay(2)
    out.delayTime.value = MODEL_DELAY
    // A real room is never digitally silent: a faint hiss, about -70 dBFS.
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const data = noise.getChannelData(0)
    let seed = 7
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0
      data[i] = (seed / 4294967296 - 0.5) * 0.0006
    }
    const hiss = ctx.createBufferSource()
    hiss.buffer = noise
    hiss.loop = true
    hiss.connect(out)
    hiss.start()
  }
  const stop = () => {
    try {
      source?.stop()
    } catch {
      /* already stopped */
    }
    source?.disconnect()
    source = null
  }
  const playFrom = (offset) => {
    stop()
    if (!armed || offset >= armed.duration) return
    source = ctx.createBufferSource()
    source.buffer = armed
    source.connect(out)
    source.start(0, offset)
  }
  const decode = async (url) => {
    ensure()
    const data = await (await fetch(url)).arrayBuffer()
    return ctx.decodeAudioData(data)
  }
  navigator.mediaDevices.getUserMedia = async () => {
    ensure()
    await ctx.resume()
    // A fresh stream per request, as a real microphone gives: the app stops the tracks of the old one.
    const mic = ctx.createMediaStreamDestination()
    out.connect(mic)
    return mic.stream
  }
  // A player follows the song they hear. After "playing" (and after a seek) the element's clock stands
  // still for a moment and then runs ahead of where it settles for about 100 ms (measured in Chromium:
  // 45 to 70 ms ahead). So the performance starts when the clock first moves, but into a long delay,
  // and once the clock has settled the delay is set so that every note lands where the settled clock
  // puts it.
  let waiting = 0
  const follow = (el) => {
    following = el
    stop()
    clearTimeout(waiting)
    const from = el.currentTime
    const rate = el.playbackRate || 1
    const zeros = []
    let moved = 0
    const poll = () => {
      if (following !== el || el.paused || el.ended) return
      const now = performance.now()
      const ct = el.currentTime
      if (!moved) {
        if (ct > from + 0.001) {
          moved = now
          out.delayTime.value = HOLD
          playFrom(from / rate)
        }
      } else {
        // The wall-clock moment at which the clock, as it runs now, was at `from`. Only readings from
        // after its first 150 ms count: before that it is still catching up with itself.
        if (now - moved >= SETTLE_FROM_MS) zeros.push(now - ((ct - from) * 1000) / rate)
        if (now - moved >= SETTLE_MS) {
          const recent = zeros.sort((a, b) => a - b)
          const zero = recent[recent.length >> 1]
          out.delayTime.value = Math.max(0, zero - moved) / 1000 + MODEL_DELAY
          return
        }
      }
      waiting = setTimeout(poll, 2)
    }
    poll()
  }
  document.addEventListener('playing', (e) => e.target instanceof HTMLMediaElement && follow(e.target), true)
  for (const type of ['pause', 'ended']) document.addEventListener(type, (e) => e.target === following && stop(), true)
  document.addEventListener('seeked', (e) => e.target === following && !following.paused && follow(following), true)
  window.__student = {
    async arm(url) {
      stop()
      armed = url ? await decode(url) : null
    },
    async noodle(url) {
      stop()
      const buffer = await decode(url)
      source = ctx.createBufferSource()
      source.buffer = buffer
      source.loop = true
      source.connect(out)
      source.start()
    },
    rest() {
      stop()
    },
  }
}

/** The stored attempt's timing, for the log: how early or late the app judged the playing to be. */
function timing(attempt) {
  if (!attempt) return ''
  const median = attempt.medianMs == null ? 'n/a' : `${Math.round(attempt.medianMs)} ms`
  const spread = attempt.spreadMs == null ? 'n/a' : `${Math.round(attempt.spreadMs)} ms`
  const bars = attempt.misses > 0 && attempt.perBar ? `; share hit per bar ${attempt.perBar.map((x) => Math.round(x * 100)).join(' ')}` : ''
  return `[${attempt.perfects} perfect, ${attempt.goods} good, ${attempt.misses} missed; timing median ${median}, spread ${spread}${bars}]`
}

/** Playing that is exactly in time must be judged in time: mostly "perfect", and no steady lead or lag. */
function checkTiming(attempt, label) {
  if (!attempt) return check(false, `${label}: an attempt was stored`)
  const hits = attempt.perfects + attempt.goods
  check(hits > 0 && attempt.perfects >= hits * 0.7, `${label}: playing in time is judged in time (${attempt.perfects} of ${hits} hits perfect)`)
  if (attempt.medianMs != null) check(Math.abs(attempt.medianMs) <= 25, `${label}: no steady lead or lag (median ${Math.round(attempt.medianMs)} ms)`)
}

/** "You hit 14 of 16 notes" / "Level 3 · 14 of 15 notes" → [14, 16]. */
function hits(text) {
  const m = text.match(/(\d+)\s+of\s+(\d+)\s+notes/i)
  return m ? [Number(m[1]), Number(m[2])] : null
}

async function lastAttempt(page) {
  return page.evaluate(async () => {
    const req = indexedDB.open('guitar-trainer')
    const db = await new Promise((res, rej) => {
      req.onsuccess = () => res(req.result)
      req.onerror = () => rej(req.error)
    })
    if (!db.objectStoreNames.contains('attempts')) return null
    const all = await new Promise((res, rej) => {
      const r = db.transaction('attempts').objectStore('attempts').getAll()
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    db.close()
    const a = all[all.length - 1]
    return a ? { kind: a.kind, perfects: a.perfects, goods: a.goods, misses: a.misses, medianMs: a.timingMedianMs, spreadMs: a.timingStdevMs, coverage: a.coverage, perBar: a.perBar ?? null } : null
  })
}

async function songId(page, builtinId) {
  return page.evaluate(async (wanted) => {
    const req = indexedDB.open('guitar-trainer')
    const db = await new Promise((res, rej) => {
      req.onsuccess = () => res(req.result)
      req.onerror = () => rej(req.error)
    })
    const all = await new Promise((res, rej) => {
      const r = db.transaction('songs').objectStore('songs').getAll()
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    db.close()
    return all.find((s) => s.builtinId === wanted)?.id ?? null
  }, builtinId)
}

async function main() {
  if (!process.env.BASE_URL && !process.env.SKIP_BUILD) {
    log('building the app…')
    const build = spawnSync('npx', ['vite', 'build'], { env: process.env, encoding: 'utf8' })
    if (build.status !== 0) throw new Error(`the app does not build:\n${build.stdout}\n${build.stderr}`)
  }
  log('rendering the performances…')
  const fixtures = buildFixtures()
  const preview = await startPreview()
  const base = preview.url.replace(/\/$/, '')
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] })
  const consoleErrors = []
  try {
    const context = await browser.newContext({ ...(DEVICE ?? { viewport: { width: 1280, height: 800 } }), permissions: ['microphone'] })
    await context.route('**/__student/*', (route) => {
      const name = path.basename(new URL(route.request().url()).pathname)
      route.fulfill({ path: path.join(FIXTURES, name), contentType: 'audio/wav' })
    })
    await context.addInitScript(virtualMicrophone)
    const page = await context.newPage()
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`))
    page.on('console', (msg) => msg.type() === 'error' && consoleErrors.push(`console: ${msg.text()}`))
    const wav = (key) => `${base}/__student/${fixtures[key].file}`
    const arm = (key) => page.evaluate((url) => window.__student.arm(url), key ? wav(key) : null)

    // A brand-new learner goes through the set-up wizard, strumming when the microphone check asks.
    await page.goto(`${base}/#/start`)
    await page.waitForSelector('[data-testid="start-here"]', { timeout: 15000 })
    await page.getByTestId('start-experience-new').click()
    for (let i = 0; i < 6 && !(await page.getByTestId('start-mic-allow').count()); i++) {
      const song = page.locator('[data-testid^="start-song-"]').first()
      if (await song.count()) await song.click()
      if (await page.getByTestId('start-mic-allow').count()) break
      await page.getByTestId('start-next').click()
      await page.waitForTimeout(150)
    }
    await page.evaluate((url) => window.__student.noodle(url), wav('lesson1-drill'))
    await page.getByTestId('start-mic-allow').click()
    const heard = await page
      .getByTestId('start-mic-ok')
      .waitFor({ timeout: 15000 })
      .then(() => true)
      .catch(() => false)
    check(heard, 'set-up: the microphone check hears the guitar')
    await page.evaluate(() => window.__student.rest())
    await page.getByTestId('start-next').click()
    await page.getByRole('button', { name: /skip tuning/i }).click()
    await page.waitForSelector('[data-testid="start-finish"]', { timeout: 10000 })
    await page.getByTestId('start-finish').click()
    await page.waitForSelector('[data-testid="first-steps-card"]', { timeout: 30000 })

    // Sync your sound, as the app asks before it scores: a muted strum on every click. What the app
    // measures has to be this rig's delay, and everything played afterwards is judged with it.
    await page.goto(`${base}/#/settings?calibrate=1`)
    await page.waitForSelector('[data-testid="calibrate-start"]', { timeout: 15000 })
    await page.evaluate((url) => window.__student.arm(url), `${base}/__student/calibration-strums.wav`)
    await page.getByTestId('calibrate-start').click()
    await page.locator('[data-testid="calibrate-result"], [data-testid="calibrate-error"]').first().waitFor({ timeout: 30000 })
    const measured = (await page.getByTestId('calibrate-result').count()) ? await page.getByTestId('calibrate-result').innerText() : await page.getByTestId('calibrate-error').innerText()
    const ms = Number((measured.match(/about\s+(\d+)\s*ms/) ?? [])[1])
    log(`     calibration: ${measured.split('\n')[0]}`)
    check(ms >= 245 && ms <= 295, `the calibration measures this rig's delay of about 270 ms (${Number.isNaN(ms) ? measured.split('\n')[0] : `${ms} ms`})`)
    if (await page.getByTestId('calibrate-use').count()) await page.getByTestId('calibrate-use').click()
    await arm(null)
    await page.goto(`${base}/#/`)
    await page.waitForSelector('[data-testid="first-steps-card"]', { timeout: 30000 })

    // Lesson 1: read the cards, then play the drill.
    await page.getByTestId('first-steps-start').click()
    await page.waitForSelector('[data-testid="lesson-learn"]', { timeout: 15000 })
    for (let i = 0; i < 8 && (await page.getByTestId('lesson-next').count()); i++) {
      await page.getByTestId('lesson-next').click()
      await page.waitForTimeout(150)
    }
    await page.waitForSelector('[data-testid="lesson-try"]', { timeout: 20000 })
    await page.waitForSelector('[data-testid="start"]', { timeout: 20000 })

    const drill = async (key, label) => {
      await page.waitForSelector('[data-testid="lesson-feedback"]', { timeout: 120000 })
      const text = await page.getByTestId('lesson-score').innerText()
      const attempt = await lastAttempt(page)
      log(`     ${label}: "${text}"`, timing(attempt))
      return { text, got: hits(text), attempt }
    }

    await arm('lesson1-drill')
    await page.getByTestId('start').click()
    const right = await drill('lesson1-drill', 'played right')
    await page.screenshot({ path: path.join(OUT, `student-drill${SUFFIX}.png`) })
    check(!!right.got && right.got[1] === fixtures['lesson1-drill'].groups, `lesson 1 drill: the app judged all ${fixtures['lesson1-drill'].groups} notes (${right.text})`)
    check(!!right.got && right.got[0] >= Math.ceil(right.got[1] * 0.9), `lesson 1 drill played right is heard as right (${right.text})`)
    checkTiming(right.attempt, 'lesson 1 drill')

    await arm('lesson1-drill-wrong')
    await page.getByTestId('lesson-again').click()
    await page.waitForSelector('[data-testid="lesson-feedback"]', { state: 'detached', timeout: 10000 })
    const wrong = await drill('lesson1-drill-wrong', 'played a tone too high')
    check(!!wrong.got && wrong.got[0] <= 1, `lesson 1 drill played on the wrong frets does not pass (${wrong.text})`)

    await arm(null)
    await page.getByTestId('lesson-again').click()
    await page.waitForSelector('[data-testid="lesson-feedback"]', { state: 'detached', timeout: 10000 })
    const silent = await drill(null, 'not played at all')
    check(/did not hear/i.test(silent.text), `lesson 1 drill with nobody playing is not scored, and says so (${silent.text})`)

    // On to the lesson's song (slowed down by the lesson).
    await arm('lesson1-song')
    await page.getByTestId('lesson-continue').click()
    await page.waitForSelector('[data-testid="lesson-play"]', { timeout: 30000 })
    await page.waitForSelector('[data-testid="start"]', { timeout: 20000 })
    await page.getByTestId('start').click()
    const song = await drill('lesson1-song', 'lesson song played right')
    await page.screenshot({ path: path.join(OUT, `student-song${SUFFIX}.png`) })
    check(!!song.got && song.got[0] >= Math.ceil(song.got[1] * 0.9), `lesson 1 song at ${Math.round(fixtures['lesson1-song'].speed * 100)}% speed is heard as right (${song.text})`)

    // Songs from the library at full speed, including strummed chords.
    for (const key of Object.keys(fixtures).filter((k) => k.startsWith('song-'))) {
      const fixture = fixtures[key]
      await page.goto(`${base}/#/songs`)
      await page.waitForSelector(`text=${fixture.title}`, { timeout: 60000 })
      const id = await songId(page, key.slice('song-'.length))
      check(id !== null, `${fixture.title} is in the library`)
      if (id === null) continue
      await page.goto(`${base}/#/play/${id}`)
      await page.waitForSelector('[data-testid="start"]', { timeout: 30000 })
      await arm(key)
      await page.getByTestId('start').click()
      await page.waitForSelector('[data-testid="results"]', { timeout: 180000 })
      const text = (await page.getByTestId('results').innerText()).replace(/\s+/g, ' ')
      const got = hits(text)
      const attempt = await lastAttempt(page)
      log(`     ${fixture.title}: ${text.slice(0, 80)}`, timing(attempt))
      await page.screenshot({ path: path.join(OUT, `student-${key}${SUFFIX}.png`) })
      check(!!got && got[1] === fixture.groups, `${fixture.title}: every note on screen was judged (${got ? got.join(' of ') : text.slice(0, 60)})`)
      check(!!got && got[0] >= Math.ceil(got[1] * 0.9), `${fixture.title} (level ${fixture.level}) played right is heard as right (${got ? got.join(' of ') : '?'})`)
      checkTiming(attempt, fixture.title)
    }

    check(consoleErrors.length === 0, `no console errors${consoleErrors.length ? `: ${consoleErrors.slice(0, 3).join(' | ')}` : ''}`)
  } finally {
    await browser.close()
    preview.stop()
  }
  if (failures.length) {
    log(`${failures.length} check(s) failed:`)
    for (const f of failures) log('  -', f)
    process.exit(1)
  }
  log('the virtual student passed')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
