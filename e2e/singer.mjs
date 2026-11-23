/**
 * The virtual singer: the browser check of the singing side. A voice that is computed, not recorded
 * from a person, sings into the app through the virtual microphone, in step with the song, and the app
 * has to hear it through its real audio worklet and judge it on screen with the real player. Singing
 * that is in tune must count, in whatever octave; singing that is flat, and not singing at all, must
 * not; and the app must never mark its own sound.
 *
 *   node e2e/singer.mjs                     builds the app, then runs
 *   SKIP_BUILD=1 node e2e/singer.mjs        uses the build in dist/ (it must be from this very code)
 *   BASE_URL=http://localhost:4173 node e2e/singer.mjs
 *   ONLY=hidden,flat node e2e/singer.mjs    only the checks named (see `NAMES`): `hidden`, `switches`, or
 *                                           a take; a name that is no check stops the run
 *   E2E_OUTPUT=<folder> node e2e/singer.mjs screenshots and takes go there, not to e2e/output
 *
 * The singing side is still behind its preview key, so every page here is opened with
 * localStorage 'gt.voice' = '1'; one check makes sure that without the key there is nothing to open.
 *
 * The takes are rendered by src/features/play/voice/e2eVoiceFixtures.test.ts from the exercise the
 * app builds, on every run, and scored there first. The app under test has to be built from the same
 * code, as for the virtual student (e2e/student.mjs): the first check compares the exercise on screen
 * with the one the takes were sung for.
 *
 * The script is a list of parts (`PARTS`), each a function that is handed the rig: the browser, the
 * address of the app, and the takes. The first part is the early proof on the hidden page
 * /voice-check, one generated exercise in the real player. A walk through the whole singing side
 * (set-up, a lesson, a song, a day's plan) is another part of the same shape.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { BROWSER_ARGS, OUT, fixtureUrl, installVirtualMicrophone, readFixture, renderFixtures, startPreview, storeRows } from './lib/virtualMic.mjs'

const require = createRequire(import.meta.url)
const { chromium, devices } = require('playwright')

const DEVICE = process.env.DEVICE ? devices[process.env.DEVICE] : null
if (process.env.DEVICE && !DEVICE) throw new Error(`Unknown device ${process.env.DEVICE}`)
const SUFFIX = process.env.DEVICE ? `-${process.env.DEVICE.replace(/\s+/g, '_')}` : ''
const ONLY = process.env.ONLY ? process.env.ONLY.split(',').map((s) => s.trim()) : null
const wanted = (name) => !ONLY || ONLY.includes(name)
mkdirSync(OUT, { recursive: true })

const SETTINGS_KEY = 'guitar-trainer.settings.v1'
/**
 * The virtual microphone stands for a device whose sound takes about 270 ms to come back (see
 * e2e/lib/virtualMic.mjs). The virtual student has the app measure that with "Sync your sound"; here
 * the setting is simply made, because what is under test is the singing, not the measuring.
 */
const RIG_LATENCY_MS = 270

function log(...args) {
  console.log(new Date().toISOString().slice(11, 19), ...args)
}

const failures = []
function check(ok, message) {
  log(ok ? '  ok  ' : '  FAIL', message)
  if (!ok) failures.push(message)
}

const oneLine = (text) => (text ?? '').replace(/\s+/g, ' ').trim()

/**
 * Runs in the page before the app: keeps what the app tells its pitch detector about the range to
 * listen in, so a check can read it back. The app sends that to its audio worklet as a message.
 */
function watchDetector() {
  const told = (window.__detector = [])
  const post = MessagePort.prototype.postMessage
  MessagePort.prototype.postMessage = function (message, ...rest) {
    if (message && message.type === 'configure' && typeof message.minFreq === 'number') told.push({ minFreq: message.minFreq, maxFreq: message.maxFreq })
    return post.call(this, message, ...rest)
  }
}

/** Runs in the page before the app, after the virtual microphone: the browser refuses the microphone, as when "Don't allow" was tapped. */
function refuseMicrophone() {
  navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'))
}

/**
 * Runs in the page before the app, after the virtual microphone: a phone with no headphones in it.
 * Whatever the app plays through Web Audio comes out of the speaker, and so it is in the microphone
 * a moment later, quieter. That is the count-in: the app clicks four times and listens for its own
 * clicks. (The song itself comes from an <audio> element and is not carried over here; the takes sung
 * "over the speaker" have it in them already.)
 */
function bareSpeaker() {
  const virtual = navigator.mediaDevices.getUserMedia
  // The room between speaker and microphone: an audio context of its own, so that nothing in it is
  // taken for the app's sound.
  let room = null
  let air = null
  const ensure = () => {
    if (room) return
    room = new AudioContext()
    air = room.createGain()
    air.gain.value = 0.3
  }
  const taps = new WeakMap()
  const connect = AudioNode.prototype.connect
  AudioNode.prototype.connect = function (target, ...rest) {
    if (target instanceof AudioDestinationNode && this.context instanceof AudioContext && this.context !== room) {
      let tap = taps.get(this.context)
      if (!tap) {
        ensure()
        tap = this.context.createMediaStreamDestination()
        taps.set(this.context, tap)
        room.createMediaStreamSource(tap.stream).connect(air)
      }
      connect.call(this, tap)
    }
    return connect.call(this, target, ...rest)
  }
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    const stream = await virtual(constraints)
    ensure()
    await room.resume()
    const mic = room.createMediaStreamDestination()
    room.createMediaStreamSource(stream).connect(mic)
    air.connect(mic)
    return mic.stream
  }
}

/**
 * A fresh device with the singing side switched on (unless `voice` is false) and the settings given,
 * looking at `route`. The settings are written once, before the app first reads them: what the app
 * stores afterwards (it turns "I use headphones" off by itself) must be what is read back.
 * `microphone: false` is a device that will not hand its microphone over; `speaker: true` one whose
 * microphone hears its own speaker during the count-in (see `bareSpeaker`).
 */
async function openDevice(rig, route, { settings = {}, voice = true, microphone = true, speaker = false } = {}) {
  const context = await rig.browser.newContext({ ...(DEVICE ?? { viewport: { width: 1280, height: 800 } }), permissions: ['microphone'] })
  await installVirtualMicrophone(context)
  if (speaker) await context.addInitScript(bareSpeaker)
  if (!microphone) await context.addInitScript(refuseMicrophone)
  await context.addInitScript(watchDetector)
  await context.addInitScript(
    ({ key, settings, voice }) => {
      if (sessionStorage.getItem('singer-seeded')) return
      sessionStorage.setItem('singer-seeded', '1')
      if (voice) localStorage.setItem('gt.voice', '1')
      localStorage.setItem(key, JSON.stringify(settings))
    },
    { key: SETTINGS_KEY, settings: { latencyMs: RIG_LATENCY_MS, ...settings }, voice },
  )
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  page.on('console', (msg) => msg.type() === 'error' && errors.push(`console: ${msg.text()}`))
  await page.goto(`${rig.base}/#${route}`)
  return { context, page, errors }
}

const storedSettings = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}'), SETTINGS_KEY)
const noticeOf = async (page) => ((await page.getByTestId('player-notice').count()) ? oneLine(await page.getByTestId('player-notice').innerText()) : null)
const guideIsOn = async (page) => (await page.getByTestId('guide-toggle').getAttribute('aria-pressed')) === 'true'
/** The range the detector was last told to listen in, in Hz; null when it was never told. */
const detectorOf = (page) => page.evaluate(() => window.__detector[window.__detector.length - 1] ?? null)
const hz = (d) => (d ? `${Math.round(d.minFreq)} to ${Math.round(d.maxFreq)} Hz` : 'never set')
const textOf = async (page, id) => ((await page.getByTestId(id).count()) ? oneLine(await page.getByTestId(id).innerText()) : null)

/** Taps the microphone button and waits until it reads `on` or `off`. */
async function tapMicrophone(page, state) {
  await page.getByRole('button', { name: /^Microphone/ }).click()
  await page.getByRole('button', { name: state === 'on' ? /^Microphone on/ : /^Microphone off/ }).waitFor({ timeout: 10000 })
}

/**
 * Everything the app has stored in one of its object stores; nothing when it never made its database.
 * (Asked first, because opening a database that is not there would make an empty one in the app's name.)
 */
async function storedRows(page, store) {
  const made = await page.evaluate(async () => (await indexedDB.databases()).some((d) => d.name === 'guitar-trainer'))
  return made ? storeRows(page, store) : []
}

/** Waits until the song has reached `seconds` (the position of the player's own sound). */
async function songAt(page, seconds) {
  await page.waitForFunction((t) => (document.querySelector('audio')?.currentTime ?? 0) >= t, seconds, { timeout: 60000, polling: 50 })
}

// ---------------------------------------------------------------------------------------------------
// Part 1: the early proof. One generated exercise ("Match a note") in the real player, on /voice-check.
// ---------------------------------------------------------------------------------------------------

/** /voice-check with the player ready and its guide track there, on a fresh device (`device`: see `openDevice`). */
async function openVoiceCheck(rig, settings = {}, options = {}) {
  const device = await openDevice(rig, '/voice-check', { ...options, settings })
  await device.page.waitForSelector('[data-testid="voice-check"]', { timeout: 20000 })
  await device.page.waitForSelector('[data-testid="start"]', { timeout: 20000 })
  // The guide track is rendered after the page has opened; the switch for it appears when it is there.
  await device.page.waitForSelector('[data-testid="guide-toggle"]', { timeout: 20000 })
  return device
}

/**
 * Sings one take from the start button to the result and reads the result off the page. `during`
 * runs while the song plays. The result is on the page for every run, counted or not. `name` is what
 * the run is called in the log and in its screenshot, when one take is sung in more than one run.
 */
async function singTake(rig, page, take, during, name = take) {
  const { voiceCheck } = rig.fixtures
  await page.evaluate((url) => window.__student.arm(url), fixtureUrl(rig.base, voiceCheck.takes[take].file))
  await page.getByTestId('start').click()
  if (during) await during()
  const result = page.getByTestId('voice-check-result')
  await result.waitFor({ timeout: Math.round(voiceCheck.seconds * 1000) + 60000 })
  const read = {
    verdict: await result.getAttribute('data-verdict'),
    hits: Number(await textOf(page, 'voice-check-hits')),
    total: Number(await textOf(page, 'voice-check-total')),
    // What the Coach makes of the round (a note that is on the note but not spot on counts for less than one).
    accuracy: Number((await result.getAttribute('data-accuracy')) ?? Number.NaN),
    line: await textOf(page, 'voice-check-line'),
    tip: await textOf(page, 'voice-check-tip'),
    card: await textOf(page, 'no-score'),
    cardVerdict: (await page.getByTestId('no-score').count()) ? await page.getByTestId('no-score').getAttribute('data-verdict') : null,
    notice: await noticeOf(page),
  }
  log(`     ${name}: ${read.hits} of ${read.total} notes, accuracy ${read.accuracy}, ${read.verdict}${read.tip ? ` | tip: ${read.tip}` : ''}${read.notice ? ` | notice: ${read.notice}` : ''}`)
  await page.screenshot({ path: path.join(OUT, `singer-check-${name}${SUFFIX}.png`) })
  return read
}

/** "Try again" on the card of a run that did not count: the player is back at its start button, the old result gone. */
async function tryAgain(page) {
  await page.getByTestId('no-score-retry').click()
  await page.getByTestId('voice-check-result').waitFor({ state: 'detached', timeout: 5000 })
  await page.waitForSelector('[data-testid="start"]', { timeout: 10000 })
}

/** From this accuracy on the Coach calls a round clean (docs/SINGING.md §9: what singing in tune must reach). */
const CLEAN = 0.85

const noErrors = (errors, take) => check(errors.length === 0, `${take}: no console errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`)

/** The takes of the early proof, by the name of the take each sings. */
const TAKES = {
  // A bare phone, no headphones: the speaker's click and starting notes are in the microphone with the singer.
  async 'octave-down'(rig) {
    const { context, page, errors } = await openVoiceCheck(rig)
    check(!(await guideIsOn(page)), 'no headphones: the guide voice starts off')
    const ready = oneLine(await page.getByTestId('player-exercise').innerText())
    check(/guide off/.test(ready) && !/guitar/i.test(ready), `the ready screen speaks of the guide, not of a guitar ("${ready.slice(0, 160)}")`)
    const read = await singTake(rig, page, 'octave-down', async () => {
      // In the middle of the first answer: the lanes with the dot on the bar.
      await songAt(page, 5.5)
      await page.screenshot({ path: path.join(OUT, `singer-check-lanes${SUFFIX}.png`) })
      // With the guide off nothing of the app can score, so a change of devices is nobody's business.
      await page.evaluate(() => navigator.mediaDevices.dispatchEvent(new Event('devicechange')))
      await page.waitForTimeout(500)
      check((await noticeOf(page)) === null, 'guide off: a change of headphones or speaker in the middle of the run says nothing')
    })
    check(read.total === rig.fixtures.voiceCheck.notes, `every note on screen was judged (${read.total} of ${rig.fixtures.voiceCheck.notes})`)
    check(read.verdict === 'counted', `sung in tune an octave below the lanes, the run counts (${read.verdict})`)
    check(read.total > 0 && read.hits >= Math.ceil(read.total * 0.85), `sung in tune an octave below the lanes is heard as on the note (${read.hits} of ${read.total})`)
    check(read.accuracy >= CLEAN, `and the Coach would call it a clean round (accuracy ${read.accuracy}, clean from ${CLEAN})`)
    check(/^You were on the note for \d+ of \d+ notes?\.$/.test(read.line ?? ''), `the result is said in a singer's words ("${read.line}")`)
    check(/octave lower/.test(read.tip ?? '') && /counts/.test(read.tip ?? ''), `and the singer is told the lower octave counts ("${read.tip}")`)
    // This take lies from D2 to F#2 (73 to 93 Hz), under the lowest string of a guitar; a voice has no notes where a guitar's highest are.
    const listening = await detectorOf(page)
    check(!!listening && listening.minFreq <= 73 && listening.maxFreq >= 200 && listening.maxFreq <= 1200, `the detector listened where a voice is, the octave below the lanes included (${hz(listening)})`)
    // The page is for checking. A round sung here must not turn up in anybody's practice record.
    const saved = { attempts: (await storedRows(page, 'attempts')).length, sessions: (await storedRows(page, 'sessions')).length, skills: (await storedRows(page, 'skillStates')).length }
    check(saved.attempts + saved.sessions + saved.skills === 0, `the check page saves nothing of a round that counted (${saved.attempts} attempts, ${saved.sessions} sessions, ${saved.skills} skill states)`)
    // The detector is one for the whole app: whoever opens the microphone next must find a guitar's range again.
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.waitForSelector('[data-testid="voice-check"]', { state: 'detached', timeout: 10000 })
    const left = await detectorOf(page)
    check(!!left && left.minFreq === 55 && left.maxFreq === 1500, `leaving the sung exercise hands the detector back with the whole range of a guitar (${hz(left)})`)
    noErrors(errors, 'octave-down')
    await context.close()
  },

  async flat(rig) {
    const { context, page, errors } = await openVoiceCheck(rig)
    const read = await singTake(rig, page, 'flat')
    check(read.verdict === 'counted', `sung 150 cents flat, the singer is heard and the run counts (${read.verdict})`)
    check(read.total > 0 && read.hits === 0, `sung 150 cents flat, no note is on the note (${read.hits} of ${read.total})`)
    check(/under the note/.test(read.tip ?? ''), `and the tip says which way to go ("${read.tip}")`)
    noErrors(errors, 'flat')
    await context.close()
  },

  async silence(rig) {
    const { context, page, errors } = await openVoiceCheck(rig)
    const read = await singTake(rig, page, 'silence')
    check(read.cardVerdict === 'unscored' && read.verdict === 'unscored', `nobody sings: nothing was scored, and the card says so (${read.verdict}, card ${read.cardVerdict})`)
    check(read.hits === 0, `nobody sings: no note counts (${read.hits} of ${read.total})`)
    check(/could not hear you sing/.test(read.card ?? '') && !/guitar/i.test(read.card ?? ''), `the card speaks to a singer ("${(read.card ?? '').slice(0, 120)}")`)
    noErrors(errors, 'silence')
    await context.close()
  },

  // A bare phone and nobody sings: all the microphone hears is the app's own click and starting notes.
  async 'own-track'(rig) {
    const { context, page, errors } = await openVoiceCheck(rig)
    const read = await singTake(rig, page, 'own-track')
    check(read.hits === 0, `guide off, the app's own starting notes come back through the microphone: they score nothing (${read.hits} of ${read.total})`)
    check(read.verdict === 'unscored', `and the run reads as not heard, not as the speaker being heard (${read.verdict})`)
    check(read.notice === null, `no notice blames the speaker (${read.notice})`)
    check((await storedSettings(page)).voiceHeadphones !== true, 'the headphones setting is untouched')
    noErrors(errors, 'own-track')
    await context.close()
  },

  // "I use headphones" is set but none are worn: the guide voice sings every note into the microphone.
  async guide(rig) {
    const { context, page, errors } = await openVoiceCheck(rig, { voiceHeadphones: true })
    await page.waitForFunction(() => document.querySelector('[data-testid="guide-toggle"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 5000 }).catch(() => {})
    check(await guideIsOn(page), 'headphones set: the guide voice switches on when its track arrives')
    const read = await singTake(rig, page, 'guide')
    check(read.verdict === 'bleed' && read.cardVerdict === 'bleed', `the guide heard through the microphone does not count (${read.verdict}, card ${read.cardVerdict})`)
    check(/guide/.test(read.notice ?? '') && /headphones/i.test(read.notice ?? ''), `the notice says what to do ("${read.notice}")`)
    check((await page.getByTestId('speaker-mode').count()) === 0, 'no speaker mode is offered for singing')
    check((await storedSettings(page)).voiceHeadphones === false, '"I use headphones" is set back to off')
    check(/own sound/.test(read.card ?? '') && /guide/.test(read.card ?? ''), `the card speaks of the guide ("${(read.card ?? '').slice(0, 120)}")`)
    // The card offers "Try again": with the guide still on, that try would be lost the same way.
    await page.waitForFunction(() => document.querySelector('[data-testid="guide-toggle"]')?.getAttribute('aria-pressed') === 'false', null, { timeout: 3000 }).catch(() => {})
    check(!(await guideIsOn(page)), 'and the guide voice is switched off for the next try')
    // That next try, as the card offers it: a bare phone now, the singer over the click and the starting
    // notes. Nothing of the lost run may hang on to it.
    await tryAgain(page)
    const again = await singTake(rig, page, 'octave-down', null, 'after-guide')
    check(again.verdict === 'counted' && again.cardVerdict === null, `"Try again" after that, with the guide off: singing in tune counts (${again.verdict})`)
    check(again.total > 0 && again.hits >= Math.ceil(again.total * 0.85), `and is heard as on the note (${again.hits} of ${again.total})`)
    check(again.notice === null, `the notice about the guide is gone (${again.notice})`)
    check(!(await guideIsOn(page)) && (await storedSettings(page)).voiceHeadphones === false, 'the guide and "I use headphones" stay off')
    noErrors(errors, 'guide')
    await context.close()
  },

  // Headphones on, the guide in them, only the singer in the microphone. Then the headphones come out.
  async 'in-tune'(rig) {
    const { context, page, errors } = await openVoiceCheck(rig, { voiceHeadphones: true })
    await page.waitForFunction(() => document.querySelector('[data-testid="guide-toggle"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 5000 }).catch(() => {})
    check(await guideIsOn(page), 'headphones set: the guide voice is on')
    let notice = null
    const read = await singTake(rig, page, 'in-tune', async () => {
      await songAt(page, 6)
      await page.evaluate(() => navigator.mediaDevices.dispatchEvent(new Event('devicechange')))
      await page.waitForSelector('[data-testid="player-notice"]', { timeout: 3000 }).catch(() => {})
      notice = await noticeOf(page)
    })
    check(read.total > 0 && read.hits >= Math.ceil(read.total * 0.85), `sung in tune at pitch with the guide in the headphones is heard as on the note (${read.hits} of ${read.total})`)
    check(/headphones/i.test(notice ?? '') && /practice/.test(notice ?? ''), `headphones changed with the guide on: the notice says the run is practice now ("${notice}")`)
    check(read.verdict === 'partial' && read.cardVerdict === 'partial', `and the run is practice, not a result (${read.verdict}, card ${read.cardVerdict})`)
    check(/sung/.test(read.card ?? '') && /headphones/.test(read.card ?? ''), `the card says why, in a singer's words ("${(read.card ?? '').slice(0, 120)}")`)
    check((await storedSettings(page)).voiceHeadphones === true, 'the headphones setting stays as it was')
    // The headphones are back in. Sung again with the guide in them, and this time nothing changes on the
    // way: a singer who is not the speaker must get a result, and the run before must not make it practice.
    await tryAgain(page)
    check(await guideIsOn(page), '"Try again": the guide voice is still on')
    const again = await singTake(rig, page, 'in-tune', null, 'in-tune-again')
    check(again.verdict === 'counted' && again.cardVerdict === null, `sung again with the guide in the headphones and no change on the way: the run counts (${again.verdict})`)
    check(again.total > 0 && again.hits >= Math.ceil(again.total * 0.85) && again.accuracy >= CLEAN, `and it is a clean round (${again.hits} of ${again.total}, accuracy ${again.accuracy})`)
    check(again.notice === null, `no notice is left over from the run before (${again.notice})`)
    check((await storedSettings(page)).voiceHeadphones === true && (await guideIsOn(page)), 'a singer with headphones on is not taken for the speaker: the setting and the guide stay on')
    noErrors(errors, 'in-tune')
    await context.close()
  },

  // A bare phone again. The singer stops the song in a rest (someone at the door) and carries on.
  async pause(rig) {
    const { context, page, errors } = await openVoiceCheck(rig)
    const read = await singTake(rig, page, 'octave-down', async () => {
      // After the first answer (it ends at 7 s), while the second note is being sung to the singer.
      await songAt(page, 8.3)
      await page.getByRole('button', { name: 'Pause', exact: true }).click()
      await page.waitForTimeout(1500)
      check(await page.evaluate(() => document.querySelector('audio').paused), 'the pause button stops the song')
      await page.getByRole('button', { name: 'Play', exact: true }).click()
    }, 'pause')
    check(read.verdict === 'counted', `paused in a rest and carried on: the run still counts (${read.verdict})`)
    check(read.total > 0 && read.hits >= Math.ceil(read.total * 0.85), `and every note is heard as on the note, before the pause and after (${read.hits} of ${read.total})`)
    check(read.notice === null, `no notice (${read.notice})`)
    noErrors(errors, 'pause')
    await context.close()
  },

  // A bare phone whose microphone hears the count-in clicks of its own speaker, as every phone without
  // headphones does. Nobody sings; what matters happens before the first note.
  async speaker(rig) {
    const { context, page, errors } = await openVoiceCheck(rig, {}, { speaker: true })
    await page.evaluate(() => window.__student.arm(null))
    // Guide off: the click and the starting notes are all the app plays, and they cannot score. Hearing them is how a bare phone works.
    await page.getByTestId('start').click()
    await songAt(page, 1)
    check((await noticeOf(page)) === null, `guide off: the app's own count-in clicks in the microphone are no reason for a notice (${await noticeOf(page)})`)
    await page.getByRole('button', { name: 'Restart', exact: true }).click()
    await page.waitForSelector('[data-testid="start"]', { timeout: 10000 })
    // Now the guide is switched on by hand, with no headphones: the same clicks mean the guide voice would be marking itself.
    await page.getByTestId('guide-toggle').click()
    check(await guideIsOn(page), 'the guide voice can be switched on by hand')
    await page.getByTestId('start').click()
    await page.waitForSelector('[data-testid="player-notice"]', { timeout: 15000 }).catch(() => {})
    const notice = await noticeOf(page)
    check(/hearing the speaker/.test(notice ?? '') && /will not count/.test(notice ?? '') && /headphones/i.test(notice ?? '') && /guide off/.test(notice ?? ''), `guide on: the clicks heard in the count-in stop the run from counting, and the notice says what to do ("${notice}")`)
    check((await page.getByTestId('speaker-mode').count()) === 0, 'and it does not offer speaker mode, which would take the voice out with the guide')
    await songAt(page, 1)
    check(await guideIsOn(page), 'the sound is not swapped under a run: the guide plays on to the end of it')
    // Called off: the next start must not be lost the same way.
    await page.getByRole('button', { name: 'Restart', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('[data-testid="guide-toggle"]')?.getAttribute('aria-pressed') === 'false', null, { timeout: 3000 }).catch(() => {})
    check(!(await guideIsOn(page)), 'the run called off: the guide voice is switched off for the next start')
    noErrors(errors, 'speaker')
    await context.close()
  },

  // The browser will not hand the microphone over. Somebody sings all the same.
  async 'no-microphone'(rig) {
    const { context, page, errors } = await openVoiceCheck(rig, {}, { microphone: false })
    let said = ''
    const read = await singTake(rig, page, 'in-tune', async () => {
      await songAt(page, 2)
      said = oneLine(await page.getByTestId('player-exercise').innerText())
    }, 'no-microphone')
    check(/Microphone: .*sing along without scoring/.test(said) && !/play along/.test(said), `no microphone: the player says so, to a singer ("${(said.match(/Microphone: [^.]*\.[^.]*\./) ?? [said.slice(0, 120)])[0]}")`)
    check(read.verdict === 'unscored' && read.cardVerdict === 'unscored', `and the run is not scored: no round of misses is made of it (${read.verdict}, card ${read.cardVerdict})`)
    check(read.hits === 0, `no note counts (${read.hits} of ${read.total})`)
    // The refusal itself is the only thing the browser may complain of.
    const other = errors.filter((e) => !/Permission denied|NotAllowedError/.test(e))
    noErrors(other, 'no-microphone')
    await context.close()
  },
}

/**
 * Where the guide switch stands before anything is sung. For a guitar it follows speaker mode (echo
 * cancellation); for singing it follows "I use headphones" and nothing else, so this device has speaker
 * mode on and no headphones: a switch that still went by the guitar's rule would be on.
 */
async function switches(rig) {
  const { context, page, errors } = await openVoiceCheck(rig, { echoCancellation: true })
  check(!(await guideIsOn(page)), 'speaker mode on, no headphones: the guide voice still starts off')
  await tapMicrophone(page, 'on')
  await tapMicrophone(page, 'off')
  check(await guideIsOn(page), 'microphone switched off by hand: the guide sings, there is nothing to score')
  await tapMicrophone(page, 'on')
  check(!(await guideIsOn(page)), 'microphone on again: the guide goes back off, speaker mode or not')
  noErrors(errors, 'switches')
  await context.close()
}

/** What `ONLY` can name. A part that is added puts the names of its checks here as well. */
const NAMES = ['hidden', 'switches', ...Object.keys(TAKES)]

/** What a typed address that leads nowhere shows, once the app has settled. */
async function pageText(rig, route, voice) {
  const { context, page } = await openDevice(rig, route, { voice })
  await page.waitForFunction(() => (document.getElementById('root')?.innerText ?? '').trim().length > 0, null, { timeout: 20000 })
  await page.waitForTimeout(500)
  const text = oneLine(await page.evaluate(() => document.getElementById('root').innerText))
  const player = (await page.getByTestId('voice-check').count()) + (await page.getByTestId('start').count())
  await context.close()
  return { text, player }
}

async function voiceCheck(rig) {
  log('the early proof: one sung exercise in the real player (/voice-check)')

  // Hidden until the singing side is switched on: without the key the address is like any other that does not exist.
  if (wanted('hidden')) {
    const hidden = await pageText(rig, '/voice-check', false)
    const nowhere = await pageText(rig, '/no-such-page', false)
    check(hidden.player === 0 && hidden.text === nowhere.text, `without the preview key /voice-check does not exist (it shows "${hidden.text.slice(0, 60)}", as any unknown address does)`)
  }

  const opened = await openVoiceCheck(rig).catch((err) => err)
  const ready = !(opened instanceof Error)
  check(ready, `with the preview key /voice-check opens with the player ready${ready ? '' : ` (${opened.message.split('\n')[0]})`}`)
  if (!ready) return
  // The page and the takes are built from the same code: a build that is older than the takes shows another
  // exercise, or the same exercise with other notes in it (its name only tells how it was asked for).
  const root = opened.page.getByTestId('voice-check')
  const shown = { exercise: await root.getAttribute('data-exercise'), chart: await root.getAttribute('data-chart') }
  const sungFor = rig.fixtures.voiceCheck
  check(shown.exercise === sungFor.exercise, `the page shows the exercise the takes were sung for (${shown.exercise}, takes for ${sungFor.exercise})`)
  check(shown.chart === sungFor.chart, `with the notes the takes hold, each where the takes have it (${shown.chart}; takes: ${sungFor.chart})`)
  await opened.context.close()
  if (shown.exercise !== sungFor.exercise || shown.chart !== sungFor.chart) return

  if (wanted('switches')) await switches(rig).catch((err) => check(false, `switches: ${err.message.split('\n')[0]}`))

  for (const [take, run] of Object.entries(TAKES)) {
    if (!wanted(take)) continue
    try {
      await run(rig)
    } catch (err) {
      check(false, `${take}: ${err.message.split('\n')[0]}`)
    } finally {
      // A take that gave up half-way leaves its device open, with the song still playing on it.
      for (const context of rig.browser.contexts()) await context.close().catch(() => {})
    }
  }
}

/** The parts of the check, in the order they run. */
const PARTS = [voiceCheck]

async function main() {
  // A mistyped name would otherwise run nothing and report that the singer passed.
  const unknown = (ONLY ?? []).filter((name) => !NAMES.includes(name))
  if (unknown.length) throw new Error(`ONLY names no check: ${unknown.join(', ')}. There are: ${NAMES.join(', ')}`)
  if (!process.env.BASE_URL && !process.env.SKIP_BUILD) {
    log('building the app…')
    const build = spawnSync('npx', ['vite', 'build'], { env: process.env, encoding: 'utf8' })
    if (build.status !== 0) throw new Error(`the app does not build:\n${build.stdout}\n${build.stderr}`)
  }
  log('rendering the takes…')
  renderFixtures(['src/features/play/voice/e2eVoiceFixtures.test.ts'], 'the takes')
  const fixtures = { voiceCheck: readFixture('voice-check.json') }
  const preview = await startPreview()
  const browser = await chromium.launch({ args: BROWSER_ARGS })
  try {
    const rig = { browser, base: preview.url.replace(/\/$/, ''), fixtures }
    for (const part of PARTS) await part(rig)
  } finally {
    await browser.close()
    preview.stop()
  }
  if (failures.length) {
    log(`${failures.length} check(s) failed:`)
    for (const f of failures) log('  -', f)
    process.exit(1)
  }
  log('the virtual singer passed')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
