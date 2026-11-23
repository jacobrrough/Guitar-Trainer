/**
 * The virtual student: an end-to-end test of the one thing the app is for. A new learner goes through
 * the set-up, opens lesson 1 and plays, and the "playing" is a real recorded guitar fed into the app as
 * its microphone, in step with the song. The app has to hear it through its real audio worklet, score it
 * on screen and move the learner on. A wrong performance and silence must not pass.
 *
 *   node e2e/student.mjs                     builds the app, then runs
 *   SKIP_BUILD=1 node e2e/student.mjs        uses the build in dist/ (it must be from this very code)
 *   BASE_URL=http://localhost:4173 node e2e/student.mjs
 *   E2E_OUTPUT=<folder> node e2e/student.mjs  screenshots and performances go there, not to e2e/output
 *
 * The performances are rendered by src/features/play/e2eFixtures.test.ts from the same charts the app
 * shows, on every run. The app under test has to be built from the same code: a build that is even one
 * chart correction older asks for a note the performance does not contain. Hence the build step.
 *
 * The microphone the performances are fed through, and the plumbing around it, is in
 * e2e/lib/virtualMic.mjs, shared with the virtual singer (e2e/singer.mjs).
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { BROWSER_ARGS, FIXTURES, OUT, fixtureUrl, installVirtualMicrophone, readFixture, renderFixtures, startPreview, storeRows } from './lib/virtualMic.mjs'

const require = createRequire(import.meta.url)
const { chromium, devices } = require('playwright')

const DEVICE = process.env.DEVICE ? devices[process.env.DEVICE] : null
if (process.env.DEVICE && !DEVICE) throw new Error(`Unknown device ${process.env.DEVICE}`)
const SUFFIX = process.env.DEVICE ? `-${process.env.DEVICE.replace(/\s+/g, '_')}` : ''
mkdirSync(OUT, { recursive: true })

function log(...args) {
  console.log(new Date().toISOString().slice(11, 19), ...args)
}

const failures = []
function check(ok, message) {
  log(ok ? '  ok  ' : '  FAIL', message)
  if (!ok) failures.push(message)
}

/** Renders one exercise block of today's plan (read from the app's own storage) the way the app builds it. */
function buildBlockFixture(block) {
  const file = path.join(FIXTURES, 'today-block.request.json')
  writeFileSync(file, JSON.stringify(block))
  renderFixtures(['src/features/play/e2eFixtures.test.ts'], 'the exercise of the block', { E2E_BLOCK: file })
  return readFixture('today-block.json')
}

function buildFixtures() {
  renderFixtures(['src/features/play/e2eFixtures.test.ts', 'src/features/settings/e2eCalibrationFixture.test.ts'], 'the performances')
  return readFixture('index.json')
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

/** The plan the Coach stored for today (the newest session). */
async function todaysPlan(page) {
  const sessions = await storeRows(page, 'sessions')
  const last = sessions.sort((a, b) => String(a.date).localeCompare(String(b.date))).pop()
  return last ? last.plan : null
}

async function skillRating(page, skillId) {
  const state = (await storeRows(page, 'skillStates')).find((s) => s.skillId === skillId)
  return state ? state.rating : null
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
  const browser = await chromium.launch({ args: BROWSER_ARGS })
  const consoleErrors = []
  try {
    const context = await browser.newContext({ ...(DEVICE ?? { viewport: { width: 1280, height: 800 } }), permissions: ['microphone'] })
    await installVirtualMicrophone(context)
    const page = await context.newPage()
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`))
    page.on('console', (msg) => msg.type() === 'error' && consoleErrors.push(`console: ${msg.text()}`))
    const wav = (key) => fixtureUrl(base, fixtures[key].file)
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
    await page.evaluate((url) => window.__student.arm(url), fixtureUrl(base, 'calibration-strums.wav'))
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

    // A day of practice from the plan. The learner leaves the course ("I have played before"), skips the
    // first check, and plays the first exercise of today's plan: whatever the Coach planned, at its tempo.
    await arm(null)
    await page.goto(`${base}/#/`)
    await page.waitForSelector('[data-testid="skip-course"]', { timeout: 30000 })
    await page.getByTestId('skip-course').click()
    await page.getByTestId('skip-course-confirm').click()
    await page.locator('[data-testid="setup-card"], [data-testid="plan-block"]').first().waitFor({ timeout: 30000 })
    if (await page.getByTestId('setup-skip').count()) await page.getByTestId('setup-skip').click()
    await page.waitForSelector('[data-testid="plan-block"]', { timeout: 30000 })
    const planned = await todaysPlan(page)
    const first = planned?.blocks[0]
    check(!!first && 'skillId' in first, `today's plan starts with an exercise (${planned ? planned.blocks.map((b) => b.kind).join(', ') : 'no plan stored'})`)
    if (first && 'skillId' in first) {
      const fixture = buildBlockFixture({ skillId: first.skillId, generatorId: first.generatorId, tempo: first.tempo, params: first.params })
      const before = await skillRating(page, first.skillId)
      await page.evaluate((url) => window.__student.arm(url), fixtureUrl(base, fixture.file))
      await page.getByTestId('block-start').first().click()
      await page.waitForSelector('[data-testid="block-runner"]', { timeout: 15000 })
      await page.waitForSelector('[data-testid="start"]', { timeout: 30000 })
      await page.getByTestId('start').click()
      await page.locator('[data-testid="rep-card"], [data-testid="block-result"], [data-testid="no-score"]').first().waitFor({ timeout: Math.round(fixture.seconds * 1000) + 60000 })
      const card = (await page.locator('[data-testid="rep-card"], [data-testid="block-result"], [data-testid="no-score"]').first().innerText()).replace(/\s+/g, ' ')
      const attempt = await lastAttempt(page)
      const got = attempt ? [attempt.perfects + attempt.goods, attempt.perfects + attempt.goods + attempt.misses] : null
      log(`     today, ${fixture.title} (${first.kind}, ${first.tempo} bpm): ${card.slice(0, 90)}`, timing(attempt))
      await page.screenshot({ path: path.join(OUT, `student-today${SUFFIX}.png`) })
      check(!!got && got[1] === fixture.groups, `today's exercise: every note on screen was judged (${got ? got.join(' of ') : card.slice(0, 60)})`)
      check(!!got && got[0] >= Math.ceil(got[1] * 0.9), `today's exercise played right is heard as right (${got ? got.join(' of ') : '?'})`)
      checkTiming(attempt, "today's exercise")
      if (await page.getByTestId('rep-card').count()) {
        check(/faster|same pace|next rep at/i.test(card) && !/slower/i.test(card), `a clean round is not followed by a slower one (${card.slice(0, 120)})`)
        await page.getByRole('button', { name: /finish early/i }).click()
      }
      await page.waitForSelector('[data-testid="block-result"]', { timeout: 60000 })
      const after = await skillRating(page, first.skillId)
      check(after !== null && after >= (before ?? 0), `the round counts for the skill (${first.skillId}: ${before === null ? 'new' : before.toFixed(1)} to ${after === null ? '?' : after.toFixed(1)})`)
      await page.goto(`${base}/#/`)
      await page.waitForSelector('[data-testid="plan-block"]', { timeout: 15000 })
      check((await page.locator('[data-testid="plan-block"]:has-text("done")').count()) >= 1, "today's plan shows the block as done")

      // The next block of the plan, when it is a song: the level and speed the Coach chose for it.
      const next = (await todaysPlan(page))?.blocks.find((b) => b.status === 'pending')
      const record = next?.kind === 'song' ? (await storeRows(page, 'songs')).find((s) => s.id === next.songId) : null
      if (next?.kind === 'song' && record?.builtinId && !next.loopBars) {
        const songFixture = buildBlockFixture({ builtinId: record.builtinId, level: next.level, speed: next.speed })
        await page.evaluate((url) => window.__student.arm(url), `${fixtureUrl(base, songFixture.file)}?song`)
        await page.getByTestId('block-start').first().click()
        await page.waitForSelector('[data-testid="block-runner"]', { timeout: 15000 })
        await page.waitForSelector('[data-testid="start"]', { timeout: 60000 })
        await page.getByTestId('start').click()
        const cards = page.locator('[data-testid="song-pass"], [data-testid="block-result"], [data-testid="no-score"]').first()
        await cards.waitFor({ timeout: Math.round(songFixture.seconds * 1000) + 60000 })
        const songCard = (await cards.innerText()).replace(/\s+/g, ' ')
        const songAttempt = await lastAttempt(page)
        const songGot = hits(songCard)
        log(`     today, ${songFixture.title} (level ${next.level + 1}, ${Math.round(next.speed * 100)}% speed, ${next.passes ?? 1} time(s) through): ${songCard.slice(0, 80)}`, timing(songAttempt))
        await page.screenshot({ path: path.join(OUT, `student-today-song${SUFFIX}.png`) })
        check(!!songGot && songGot[1] === songFixture.groups, `today's song: every note on screen was judged (${songGot ? songGot.join(' of ') : songCard.slice(0, 60)})`)
        check(!!songGot && songGot[0] >= Math.ceil(songGot[1] * 0.9), `today's song played right is heard as right (${songGot ? songGot.join(' of ') : '?'})`)
        check(songAttempt?.kind === 'song', `today's song is stored as a song play (${songAttempt?.kind ?? 'nothing stored'})`)
        checkTiming(songAttempt, "today's song")
      } else {
        log(`     today's next block is not a plain song block (${next ? next.kind : 'none'}): not played`)
      }
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
