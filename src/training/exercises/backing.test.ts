import { describe, expect, it } from 'vitest'
import { renderDrums } from '../../audio/synth'
import { SKILLS_BY_ID } from '../skills'
import { exerciseParams, generateExercise } from './index'
import { DEFAULT_TUNING } from './builder'
import { renderExerciseBacking, renderExerciseGuide } from './backing'

describe('renderExerciseBacking', () => {
  const skill = SKILLS_BY_ID['fret.single-string']
  const exercise = generateExercise(skill, 'melody', exerciseParams(skill, 'melody', 60), DEFAULT_TUNING)

  it('adds the click track for scoring and asks for a listening guide', () => {
    const r = renderExerciseBacking(exercise)
    expect(r.backing).toEqual(renderDrums(exercise.chart, { sampleRate: r.backingSampleRate }))
    expect(r.guide).toBeNull()
    expect(r.wantsGuide).toBe(true)
  })

  it('renders the guide with the part on top of the same click track', async () => {
    const r = renderExerciseBacking(exercise)
    const guide = await renderExerciseGuide(r)
    expect(guide.length).toBe(r.backing!.length)
    // The guide carries the plucked notes, so it differs from the click track.
    let diff = 0
    for (let i = 0; i < guide.length; i += 97) diff += Math.abs(guide[i] - r.backing![i])
    expect(diff).toBeGreaterThan(1)
  })

  it('asks for no guide when told so (tests)', () => {
    const r = renderExerciseBacking(exercise, { guide: false })
    expect(r.backing).not.toBeNull()
    expect(r.wantsGuide).toBe(false)
  })
})
