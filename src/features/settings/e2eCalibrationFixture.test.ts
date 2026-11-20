/**
 * Writes what the virtual student (e2e/student.mjs) "plays" during the app's latency calibration: a
 * short muted strum exactly on every click. Skipped unless a folder is named:
 *   E2E_FIXTURES=e2e/output/fixtures npx vitest run src/features/settings/e2eCalibrationFixture.test.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'
import { encodeWav } from '../../audio/synth'
import { clickTimes, clickTrackSeconds } from './clickTrack'

const dir = process.env.E2E_FIXTURES
const SAMPLE_RATE = 48000

it.skipIf(!dir)('writes the strums for the calibration', async () => {
  const out = path.resolve(dir!)
  mkdirSync(out, { recursive: true })
  const pcm = new Float32Array(Math.ceil(clickTrackSeconds() * SAMPLE_RATE))
  let seed = 11
  for (const time of clickTimes()) {
    const start = Math.round(time * SAMPLE_RATE)
    // Muted strings: a burst of noise that is gone in a few hundredths of a second.
    for (let n = 0; n < 0.06 * SAMPLE_RATE && start + n < pcm.length; n++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      pcm[start + n] = (seed / 4294967296 - 0.5) * 0.6 * Math.exp(-n / (0.012 * SAMPLE_RATE))
    }
  }
  writeFileSync(path.join(out, 'calibration-strums.wav'), Buffer.from(await encodeWav(pcm, SAMPLE_RATE).arrayBuffer()))
  expect(clickTimes().length).toBeGreaterThan(3)
})
