/**
 * The whole matrix: every lesson drill and song, every bundled song in full, every skill's exercise at
 * its start and target tempo, each scored in a dozen ways (two sample rates, click-track bleed, a phone
 * microphone in a noisy room, device latency, slow playback, quiet playing, silence, the click track
 * alone, wrong frets, every other note left out). Takes about twenty minutes, so it only runs on
 * request:  FULL_SIM=1 npx vitest run src/features/play/scoring.matrix.test.ts
 * It prints one line per case and fails if a total falls below the numbers the tracker was tuned to.
 */
import { expect, it } from 'vitest'
import { loadRealBank } from '../../audio/instrument/realBank.testutil'
import { atSpeed, clickTrack, delayed, everyOtherGroup, fullSongCases, lessonCases, mix, perform, phoneMic, skillCases, transposed } from './simCases.testutil'
import { simulateRun } from './simulate'

const q = (xs: number[], p: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))] : NaN)

it.skipIf(!process.env.FULL_SIM)('every case, every scenario', async () => {
  const bank = await loadRealBank()
  const emit = (l: string) => console.log(l)
  let cases = [...lessonCases(), ...fullSongCases(), ...skillCases()]
  if (process.env.SIM_ONLY) cases = cases.filter((c) => new RegExp(process.env.SIM_ONLY!).test(c.name))
  emit('case | groups | perfect 44k (P/G/M) d p10/p50/p90 | 48k | +click | phone | lat60 | 0.75x | quiet | SIL CLK | +1 -1 +2 | skip: played false | cov')
  const tot: Record<string, [number, number]> = {}
  const add = (k: string, h: number, t: number) => {
    tot[k] ??= [0, 0]
    tot[k][0] += h
    tot[k][1] += t
  }
  for (const c of cases) {
    const SR = 44100
    const hits = (r: ReturnType<typeof simulateRun>) => r.summary.perfects + r.summary.goods
    const run = (mic: Float32Array, sr = SR, extra: Partial<Parameters<typeof simulateRun>[3]> = {}, notes = c.notes, beats = c.chart.beats) => simulateRun(notes, beats, mic, { sampleRate: sr, ...extra })
    const mic = perform(c, bank, SR)
    const click = clickTrack(c, SR)
    const a = run(mic)
    const b = run(perform(c, bank, 48000), 48000)
    const withClick = run(mix(mic, click, 0.5))
    const phone = run(phoneMic(mix(mic, click, 0.5), SR))
    const lat = run(delayed(mic, 0.06, SR), SR, { latencySec: 0.06 })
    const slow = atSpeed(c, 0.75)
    const slowRun = simulateRun(c.notes, c.chart.beats, perform({ ...c, chart: slow.chart, notes: slow.notes }, bank, SR), { sampleRate: SR, speed: 0.75 })
    const quiet = run(mic.map((v) => v * 0.1))
    const sil = run(new Float32Array(mic.length))
    const clk = run(click)
    const wrong = [1, -1, 2].map((s) => run(perform(c, bank, SR, transposed(c.notes, s))))
    const half = everyOtherGroup(c.notes)
    const skip = run(mix(perform(c, bank, SR, half.played), click, 0.5))
    let skipPlayed = 0
    let skipFalse = 0
    half.order.forEach((id, i) => {
      if (skip.statuses[i] === 'hit') (half.playedIds.has(id) ? skipPlayed++ : skipFalse++)
    })
    const T = a.summary.total
    add('perfect', hits(a), T); add('48k', hits(b), T); add('click', hits(withClick), T); add('phone', hits(phone), T); add('lat60', hits(lat), T); add('slow', hits(slowRun), T); add('quiet', hits(quiet), T)
    add('silence', hits(sil), T); add('clickonly', hits(clk), T); wrong.forEach((w) => add('wrong', hits(w), T)); add('skipPlayed', skipPlayed, half.playedIds.size); add('skipFalse', skipFalse, T - half.playedIds.size)
    emit(`${c.name.padEnd(44)} | ${String(T).padStart(3)} | ${hits(a)} (${a.summary.perfects}/${a.summary.goods}/${a.summary.misses}) ${q(a.deltasMs, 0.1).toFixed(0)}/${q(a.deltasMs, 0.5).toFixed(0)}/${q(a.deltasMs, 0.9).toFixed(0)} | ${hits(b)} | ${hits(withClick)} | ${hits(phone)} | ${hits(lat)} (${q(lat.deltasMs, 0.5).toFixed(0)}) | ${hits(slowRun)} (${q(slowRun.deltasMs, 0.5).toFixed(0)}) | ${hits(quiet)} | ${hits(sil)} ${hits(clk)} | ${wrong.map(hits).join(' ')} | ${skipPlayed}/${half.playedIds.size} ${skipFalse} | ${a.result.coverage.toFixed(2)}`)
  }
  emit('TOTALS ' + Object.entries(tot).map(([k, [h, t]]) => `${k} ${h}/${t} (${((100 * h) / t).toFixed(1)}%)`).join('  '))
  const share = (k: string) => tot[k][0] / tot[k][1]
  expect(share('perfect')).toBeGreaterThanOrEqual(0.995)
  for (const k of ['48k', 'click', 'lat60', 'slow', 'quiet']) expect(share(k), k).toBeGreaterThanOrEqual(0.99)
  expect(share('phone')).toBeGreaterThanOrEqual(0.97)
  expect(tot.silence[0]).toBe(0)
  expect(tot.clickonly[0]).toBe(0)
  expect(share('wrong')).toBeLessThanOrEqual(0.02)
  expect(share('skipPlayed')).toBeGreaterThanOrEqual(0.98)
  expect(share('skipFalse')).toBeLessThanOrEqual(0.01)
}, 6_000_000)
