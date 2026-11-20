/**
 * Writes the performances the browser end-to-end test (e2e/student.mjs) plays into the app as its
 * microphone: the recorded guitar playing a lesson drill, a lesson song and a few bundled songs exactly
 * as the screen shows them, plus one wrong performance (every note a tone too high). Skipped unless a
 * folder is named:
 *   E2E_FIXTURES=e2e/output/fixtures npx vitest run src/features/play/e2eFixtures.test.ts
 * With E2E_BLOCK=<file> as well (a block of today's plan, as stored: an exercise with skillId,
 * generatorId, tempo and params, or a song with builtinId, level and speed) it writes only that
 * block's performance, built the way the app builds it: today-block.wav.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'
import { loadRealBank } from '../../audio/instrument/realBank.testutil'
import { encodeWav } from '../../audio/synth'
import { generateLevels, suggestedLevel } from '../../chart/difficulty'
import { COURSE } from '../../lessons/course'
import { BUILT_IN_SONGS } from '../../songs'
import { DEFAULT_TUNING } from '../../training/exercises/builder'
import { exerciseParams, generateExercise } from '../../training/exercises/index'
import { SKILLS_BY_ID } from '../../training/skills'
import { atSpeed, lessonCases, perform, transposed, type SimCase } from './simCases.testutil'

const dir = process.env.E2E_FIXTURES
const blockFile = process.env.E2E_BLOCK
const SAMPLE_RATE = 48000
/** Bundled songs played from the library at the level the app suggests, full speed. */
const LIBRARY_SONGS = ['ode-to-joy', 'em-am-groove', 'amazing-grace']

const groupCount = (c: SimCase) => new Set(c.notes.map((n) => n.chordId ?? `n${n.id}`)).size

it.skipIf(!dir || !blockFile)('writes the exercise of a planned block, as the app builds it', async () => {
  const out = path.resolve(dir!)
  mkdirSync(out, { recursive: true })
  const block = JSON.parse(readFileSync(blockFile!, 'utf8')) as
    | { skillId: string; generatorId: string; tempo: number; params: Record<string, unknown> }
    | { builtinId: string; level: number; speed: number }
  let c: SimCase
  let title: string
  if ('builtinId' in block) {
    // A song block: the level of the plan, stretched to the speed of the plan (the student plays in real time).
    const builtIn = BUILT_IN_SONGS.find((s) => s.id === block.builtinId)
    expect(builtIn, `bundled song ${block.builtinId}`).toBeDefined()
    const levels = generateLevels(builtIn!.chart)
    const whole: SimCase = { name: block.builtinId, kind: 'song-full', chart: builtIn!.chart, notes: levels[Math.max(0, Math.min(levels.length - 1, block.level))].notes }
    const slow = atSpeed(whole, block.speed)
    c = { ...whole, chart: slow.chart, notes: slow.notes }
    title = builtIn!.title
  } else {
    const skill = SKILLS_BY_ID[block.skillId]
    expect(skill, `skill ${block.skillId}`).toBeDefined()
    // The same two calls as coach.exerciseForBlock.
    const params = exerciseParams(skill, block.generatorId, block.tempo, block.params)
    const exercise = generateExercise(skill, block.generatorId, params, DEFAULT_TUNING)
    expect(exercise.interaction ?? 'highway', 'an exercise played on the note lanes').not.toBe('ear')
    c = { name: `today ${block.skillId}`, kind: 'skill', chart: exercise.chart, notes: exercise.chart.notes }
    title = exercise.title
  }
  const pcm = perform(c, await loadRealBank(), SAMPLE_RATE)
  writeFileSync(path.join(out, 'today-block.wav'), Buffer.from(await encodeWav(pcm, SAMPLE_RATE).arrayBuffer()))
  writeFileSync(path.join(out, 'today-block.json'), JSON.stringify({ file: 'today-block.wav', groups: groupCount(c), seconds: pcm.length / SAMPLE_RATE, title }))
}, 120_000)

it.skipIf(!dir || !!blockFile)('writes the virtual student’s performances', async () => {
  const out = path.resolve(dir!)
  mkdirSync(out, { recursive: true })
  const bank = await loadRealBank()
  const cases = lessonCases()
  const index: Record<string, { file: string; groups: number; seconds: number; speed: number; title?: string; level?: number }> = {}
  const save = async (key: string, pcm: Float32Array, groups: number, extra: { speed?: number; title?: string; level?: number } = {}) => {
    const file = `${key}.wav`
    writeFileSync(path.join(out, file), Buffer.from(await encodeWav(pcm, SAMPLE_RATE).arrayBuffer()))
    index[key] = { file, groups, seconds: pcm.length / SAMPLE_RATE, speed: extra.speed ?? 1, title: extra.title, level: extra.level }
  }

  const lesson = COURSE[0]
  const drill = cases.find((x) => x.name.startsWith(`lesson ${lesson.number} drill `))!
  await save('lesson1-drill', perform(drill, bank, SAMPLE_RATE), groupCount(drill))
  await save('lesson1-drill-wrong', perform(drill, bank, SAMPLE_RATE, transposed(drill.notes, 2)), groupCount(drill))

  // The lesson plays its song slowed down: the student plays in real time, so the chart is stretched.
  const song = cases.find((x) => x.name.startsWith(`lesson ${lesson.number} song `))!
  const speed = lesson.play!.speed
  const slow = atSpeed(song, speed)
  await save('lesson1-song', perform({ ...song, chart: slow.chart, notes: slow.notes }, bank, SAMPLE_RATE), groupCount(song), { speed })

  for (const id of LIBRARY_SONGS) {
    const builtIn = BUILT_IN_SONGS.find((s) => s.id === id)!
    const levels = generateLevels(builtIn.chart)
    const level = suggestedLevel(builtIn.chart) - 1
    const c: SimCase = { name: id, kind: 'song-full', chart: builtIn.chart, notes: levels[level].notes }
    await save(`song-${id}`, perform(c, bank, SAMPLE_RATE), groupCount(c), { title: builtIn.title, level: level + 1 })
  }

  writeFileSync(path.join(out, 'index.json'), JSON.stringify(index, null, 1))
  expect(Object.keys(index).length).toBe(3 + LIBRARY_SONGS.length)
}, 120_000)
