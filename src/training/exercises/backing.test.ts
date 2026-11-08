import { describe, expect, it } from 'vitest'
import { SKILLS_BY_ID } from '../skills'
import { exerciseParams, generateExercise } from './index'
import { DEFAULT_TUNING } from './builder'
import { renderExerciseBacking } from './backing'

describe('renderExerciseBacking', () => {
  const skill = SKILLS_BY_ID['fret.single-string']
  const exercise = generateExercise(skill, 'melody', exerciseParams(skill, 'melody', 60), DEFAULT_TUNING)

  it('renders a click-only backing and a separate guide with the part', () => {
    const r = renderExerciseBacking(exercise)
    expect(r.backing).not.toBeNull()
    expect(r.guide).not.toBeNull()
    expect(r.guide!.length).toBe(r.backing!.length)
    // The guide carries the plucked notes, so it differs from the click track.
    let diff = 0
    for (let i = 0; i < r.backing!.length; i += 97) diff += Math.abs(r.guide![i] - r.backing![i])
    expect(diff).toBeGreaterThan(1)
  })

  it('omits the guide when asked', () => {
    const r = renderExerciseBacking(exercise, { guide: false })
    expect(r.backing).not.toBeNull()
    expect(r.guide).toBeNull()
  })
})
