/**
 * What the browser checks with a virtual performer share (e2e/student.mjs plays a recorded guitar into
 * the app, e2e/singer.mjs sings into it): a microphone that is fed from files and keeps time with the
 * song, the files themselves (rendered by the fixture writers under src/, from the charts the app
 * shows), and the built app on a port.
 *
 *   E2E_OUTPUT=<folder>   where screenshots and rendered performances go (default e2e/output). Two runs
 *                         at the same time on one machine need a folder each: they render different
 *                         performances under the same names.
 */
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// (`||`: a variable that is set but empty must not make the folder the script was started in the output folder.)
export const OUT = path.resolve(process.env.E2E_OUTPUT || 'e2e/output')
/** The rendered performances, served to the page under /__student/. */
export const FIXTURES = path.join(OUT, 'fixtures')

/** Chromium: grant the microphone without a prompt (it is replaced anyway) and let sound start without a tap. */
export const BROWSER_ARGS = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required']

/** The built app on a local port, or the one that is already running at BASE_URL. */
export async function startPreview() {
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
 * Runs fixture writers (test files that write performances when E2E_FIXTURES names a folder) and
 * throws with their output when one fails. `what` finishes the sentence "could not render …".
 * Without the module cache: the performances must come from the code as it is on disk right now.
 */
export function renderFixtures(testFiles, what, env = {}) {
  const run = spawnSync('npx', ['vitest', 'run', '--no-fsModuleCache', ...testFiles], { env: { ...process.env, E2E_FIXTURES: FIXTURES, ...env }, encoding: 'utf8' })
  if (run.status !== 0) throw new Error(`could not render ${what}:\n${run.stdout}\n${run.stderr}`)
}

/** A JSON file a fixture writer left beside its performances. */
export function readFixture(name) {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8'))
}

/** Where the page finds a rendered performance (see `installVirtualMicrophone`). */
export function fixtureUrl(base, file) {
  return `${base}/__student/${file}`
}

/**
 * Gives every page of the context the virtual microphone, and serves the rendered performances to it.
 * Call it before the first page is opened.
 */
export async function installVirtualMicrophone(context) {
  await context.route('**/__student/*', (route) => {
    const name = path.basename(new URL(route.request().url()).pathname)
    route.fulfill({ path: path.join(FIXTURES, name), contentType: 'audio/wav' })
  })
  await context.addInitScript(virtualMicrophone)
}

/** Everything in one object store of the app's database. */
export function storeRows(page, store) {
  return page.evaluate(async (name) => {
    const req = indexedDB.open('guitar-trainer')
    const db = await new Promise((res, rej) => {
      req.onsuccess = () => res(req.result)
      req.onerror = () => rej(req.error)
    })
    if (!db.objectStoreNames.contains(name)) return []
    const all = await new Promise((res, rej) => {
      const r = db.transaction(name).objectStore(name).getAll()
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    db.close()
    return all
  }, store)
}

/**
 * Runs in the page before the app: replaces the microphone with a stream we feed. `arm(url)` loads a
 * performance; it then plays whenever the app's song element plays, from the matching position, so the
 * student is "in time" the way a person following the highway is. `noodle(url)` plays freely (for the
 * set-up wizard's microphone check).
 */
export function virtualMicrophone() {
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
