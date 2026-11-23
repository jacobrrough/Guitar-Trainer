import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { VOICE_COURSE } from '../../lessons/voiceCourse'
import { CATEGORY_LABELS, SKILLS } from '../../training/skills'
import type { Attempt, LearnerModel, SkillCategory, SkillDef, SkillState } from '../../training/types'
import { VOICE_SKILLS } from '../../training/voiceSkills'
import { voiceMaxSteps } from '../../training/voicePlan'
import { SkillDetails, SkillMap } from './SkillMap'
import { bandCounts, categoriesOf, categorySummary, practiceStreakDays, ratingSeries, skillPaceText, weeklyMinutes } from './progressStats'

function attempt(at: number, extra: Partial<Attempt> = {}): Attempt {
  return { at, kind: 'practice', durationSec: 60, ...extra } as Attempt
}

// Wednesday 2026-11-11 12:00 local
const NOW = new Date(2026, 10, 11, 12).getTime()
const day = (offset: number, hour = 10) => new Date(2026, 10, 11 + offset, hour).getTime()

describe('weeklyMinutes', () => {
  it('buckets by Monday-start local weeks', () => {
    const res = weeklyMinutes(
      [attempt(day(0), { durationSec: 120 }), attempt(day(-2), { durationSec: 60 }), attempt(day(-3), { durationSec: 600 })],
      NOW,
      3,
    )
    expect(res.map((r) => r.weekStart)).toEqual(['2026-10-26', '2026-11-02', '2026-11-09'])
    expect(res.map((r) => r.minutes)).toEqual([0, 10, 3])
  })
  it('ignores attempts outside the window', () => {
    expect(weeklyMinutes([attempt(day(-100))], NOW, 2).every((r) => r.minutes === 0)).toBe(true)
  })
})

describe('ratingSeries', () => {
  it('filters by skill, requires ratingAfter and sorts ascending', () => {
    const res = ratingSeries(
      [
        attempt(3, { skillId: 'a', ratingAfter: 30 }),
        attempt(1, { skillId: 'a', ratingAfter: 10 }),
        attempt(2, { skillId: 'b', ratingAfter: 99 }),
        attempt(4, { skillId: 'a' }),
      ],
      'a',
    )
    expect(res).toEqual([
      { at: 1, rating: 10 },
      { at: 3, rating: 30 },
    ])
  })
})

describe('practiceStreakDays', () => {
  it('counts consecutive days ending today', () => {
    expect(practiceStreakDays([attempt(day(0)), attempt(day(-1)), attempt(day(-2)), attempt(day(-4))], NOW)).toBe(3)
  })
  it('allows ending yesterday', () => {
    expect(practiceStreakDays([attempt(day(-1)), attempt(day(-2))], NOW)).toBe(2)
  })
  it('is zero after a gap', () => {
    expect(practiceStreakDays([attempt(day(-2))], NOW)).toBe(0)
    expect(practiceStreakDays([], NOW)).toBe(0)
  })
})

describe('categorySummary', () => {
  it('averages effective ratings with missing as 0', () => {
    const skills = [
      { id: 'a', category: 'fretting' },
      { id: 'b', category: 'fretting' },
      { id: 'c', category: 'ear' },
    ] as SkillDef[]
    const model = {
      skills: { a: { skillId: 'a', rating: 95, lastPracticedAt: NOW } },
      songItems: {},
      profile: {},
    } as unknown as LearnerModel
    const res = categorySummary(model, skills, NOW)
    expect(res.map((r) => r.category)).toEqual(['fretting', 'ear'])
    expect(res[0]).toMatchObject({ mean: 47.5, mastered: 1, total: 2 })
    expect(res[1]).toMatchObject({ mean: 0, mastered: 0, total: 1 })
  })
})

describe('runs that did not count', () => {
  const at = new Date(2026, 4, 13, 10).getTime()
  const base = { at, kind: 'practice', perfects: 4, goods: 0, misses: 0, total: 4, timingMedianMs: null, timingStdevMs: null, coverage: 1, durationSec: 600, playedTempo: 60, targetTempo: 60, speed: 1, difficulty: 10, performance: 1, accuracy: 1, reliable: true } as const

  it('a run in which the microphone heard the app itself adds no minutes and no streak day', () => {
    const now = at + 3600_000
    expect(weeklyMinutes([{ ...base }, { ...base, bleed: true, reliable: false }], now).at(-1)?.minutes).toBe(10)
    expect(practiceStreakDays([{ ...base, bleed: true, reliable: false }], now)).toBe(0)
    expect(practiceStreakDays([{ ...base }], now)).toBe(1)
  })
})

/** A stored skill state, practised a moment ago so no rust applies. */
function state(skillId: string, rating: number, extra: Partial<SkillState> = {}): SkillState {
  return { skillId, rating, confidence: 3, tempoCeiling: 0, ease: 2.3, intervalDays: 2, plateauStep: 0, attempts: 4, lastPracticedAt: NOW, ...extra }
}

/** One device, both instruments: what the skill-state table holds once somebody plays and sings. */
function mixedModel(): LearnerModel {
  return {
    skills: {
      [SKILLS[0].id]: state(SKILLS[0].id, 95, { tempoCeiling: 92.4 }),
      [SKILLS[1].id]: state(SKILLS[1].id, 78),
      [SKILLS[2].id]: state(SKILLS[2].id, 76),
      'voice.pitch.match': state('voice.pitch.match', 80, { step: 2 }),
      'voice.pitch.hold': state('voice.pitch.hold', 91, { step: 1 }),
      'voice.pitch.steps': state('voice.pitch.steps', 40, { tempoCeiling: 66 }),
    },
    songItems: {},
    profile: {},
  } as unknown as LearnerModel
}

const GUITAR_CATEGORIES: SkillCategory[] = ['fretting', 'picking', 'chords', 'lead', 'timing', 'ear']
const VOICE_CATEGORIES: SkillCategory[] = ['pitch', 'range', 'breath']

describe('the categories of an instrument', () => {
  it('guitar keeps the six it always had, in the order the skill map draws them', () => {
    expect(categoriesOf(SKILLS)).toEqual(GUITAR_CATEGORIES)
  })

  it('singing has its own three', () => {
    expect(categoriesOf(VOICE_SKILLS)).toEqual(VOICE_CATEGORIES)
  })

  it('no skill of either instrument is left without a card', () => {
    for (const skills of [SKILLS, VOICE_SKILLS]) {
      const shown = categoriesOf(skills)
      expect(skills.filter((s) => !shown.includes(s.category))).toEqual([])
    }
  })

  it('goes by what the list holds, not by the order it is written in, and names each category once', () => {
    expect(categoriesOf([...VOICE_SKILLS].reverse())).toEqual(VOICE_CATEGORIES)
    expect(categoriesOf([...SKILLS].reverse())).toEqual(GUITAR_CATEGORIES)
    expect(categoriesOf([{ category: 'breath' }, { category: 'ear' }, { category: 'breath' }])).toEqual(['ear', 'breath'])
    expect(categoriesOf([])).toEqual([])
  })
})

describe('categorySummary for two instruments', () => {
  it('left alone it still reports the six guitar categories and no other', () => {
    const res = categorySummary(mixedModel(), [...SKILLS, ...VOICE_SKILLS], NOW)
    expect(res.map((r) => r.category)).toEqual(GUITAR_CATEGORIES)
  })

  it('takes the order to report in', () => {
    const res = categorySummary(mixedModel(), VOICE_SKILLS, NOW, ['breath', 'pitch'])
    expect(res.map((r) => r.category)).toEqual(['breath', 'pitch'])
    expect(res.map((r) => r.label)).toEqual([CATEGORY_LABELS.breath, CATEGORY_LABELS.pitch])
  })

  it('a device that plays and sings shows only the instrument asked for', () => {
    const model = mixedModel()
    const voice = categorySummary(model, VOICE_SKILLS, NOW, categoriesOf(VOICE_SKILLS))
    expect(voice.map((r) => r.category)).toEqual(VOICE_CATEGORIES)
    // Counted over the singing skills alone: the guitar skill rated 95 is in no singing category.
    expect(voice.reduce((sum, r) => sum + r.total, 0)).toBe(VOICE_SKILLS.length)
    const breath = VOICE_SKILLS.filter((s) => s.category === 'breath')
    expect(voice.find((r) => r.category === 'breath')).toMatchObject({ mean: 91 / breath.length, mastered: 1, total: breath.length })
    expect(voice.reduce((sum, r) => sum + r.mastered, 0)).toBe(1)

    const guitar = categorySummary(model, SKILLS, NOW, categoriesOf(SKILLS))
    expect(guitar.reduce((sum, r) => sum + r.total, 0)).toBe(SKILLS.length)
    // The singing skill rated 91 is not a mastered guitar skill.
    expect(guitar.reduce((sum, r) => sum + r.mastered, 0)).toBe(1)
  })
})

describe('the skills tile', () => {
  it('counts the skills of the list it is given and nothing else in the model', () => {
    const model = mixedModel()
    expect(bandCounts(model, SKILLS, NOW)).toEqual({ mastered: 1, solid: 2, total: SKILLS.length })
    expect(bandCounts(model, VOICE_SKILLS, NOW)).toEqual({ mastered: 1, solid: 1, total: VOICE_SKILLS.length })
  })

  it('a skill never practised is neither', () => {
    expect(bandCounts({ skills: {}, songItems: {}, profile: {} } as unknown as LearnerModel, VOICE_SKILLS, NOW)).toEqual({ mastered: 0, solid: 0, total: VOICE_SKILLS.length })
  })
})

describe('how far a skill has come, in the line under its bar', () => {
  const hold = VOICE_SKILLS.find((s) => s.id === 'voice.pitch.hold') as SkillDef
  const steps = VOICE_SKILLS.find((s) => s.id === 'voice.pitch.steps') as SkillDef

  it('a guitar skill says its ceiling as it always did, and only with the technical numbers on', () => {
    expect(skillPaceText(SKILLS[0], { tempoCeiling: 92.4 }, false)).toBe('ceiling 92 bpm')
    expect(skillPaceText(SKILLS[0], { tempoCeiling: 92.4 }, true)).toBeNull()
    expect(skillPaceText(SKILLS[0], { tempoCeiling: 0 }, false)).toBeNull()
    expect(skillPaceText(SKILLS[0], undefined, false)).toBeNull()
  })

  it('a step skill names its step in the learner\'s words, never a tempo', () => {
    expect(hold.steps?.map((s) => s.label)).toContain('6 beats')
    for (const simple of [true, false]) {
      const text = skillPaceText(hold, { tempoCeiling: 60, step: 1 }, simple)
      expect(text).toBe('now: 6 beats')
      expect(text).not.toMatch(/bpm|ceiling/)
    }
    // No step stored yet: the first one.
    expect(skillPaceText(hold, { tempoCeiling: 0 }, true)).toBe(`now: ${hold.steps?.[0].label}`)
  })

  it('a stored step past the end of the ladder reads as the last step', () => {
    const last = hold.steps?.at(-1)?.label
    expect(skillPaceText(hold, { tempoCeiling: 0, step: 99 }, true)).toBe(`now: ${last}`)
    expect(skillPaceText(hold, { tempoCeiling: 0, step: -3 }, true)).toBe(`now: ${hold.steps?.[0].label}`)
  })

  it('a step skill never practised says nothing', () => {
    expect(skillPaceText(hold, undefined, true)).toBeNull()
  })

  it('never names a step the singer\'s range cannot hold: practice starts from the highest one that fits', () => {
    const slides = VOICE_SKILLS.find((s) => s.id === 'voice.range.slides') as SkillDef
    const labels = slides.steps?.map((s) => s.label) ?? []
    // Reached the slide to the octave, then the easy notes were made smaller. The smallest range the app
    // stores (eight notes) holds the slide to note 5 and not the one to note 8, and so does one a note short of an octave.
    const reached = { tempoCeiling: 0, step: 2 }
    expect(skillPaceText(slides, reached, true)).toBe(`now: ${labels[2]}`)
    expect(skillPaceText(slides, reached, true, voiceMaxSteps({ low: 48, high: 55 })[slides.id])).toBe(`now: ${labels[1]}`)
    expect(skillPaceText(slides, reached, true, voiceMaxSteps({ low: 48, high: 59 })[slides.id])).toBe(`now: ${labels[1]}`)
    // A range with room for all of it changes nothing, and neither does a limit above what was reached.
    expect(skillPaceText(slides, reached, true, voiceMaxSteps({ low: 48, high: 60 })[slides.id])).toBe(`now: ${labels[2]}`)
    expect(skillPaceText(slides, { tempoCeiling: 0, step: 0 }, true, 2)).toBe(`now: ${labels[0]}`)
    // A limit that is no step of the ladder is no limit, and a tempo skill has no steps to limit.
    expect(skillPaceText(slides, reached, true, Number.NaN)).toBe(`now: ${labels[2]}`)
    expect(skillPaceText(slides, reached, true, -1)).toBe(`now: ${labels[0]}`)
    expect(skillPaceText(steps, { tempoCeiling: 66 }, false, 0)).toBe('ceiling 66 bpm')
  })

  it('a singing skill that speeds up is treated as a guitar skill is', () => {
    expect(skillPaceText(steps, { tempoCeiling: 66 }, false)).toBe('ceiling 66 bpm')
    expect(skillPaceText(steps, { tempoCeiling: 66 }, true)).toBeNull()
  })
})

describe('the skill map', () => {
  const noop = () => {}
  const draw = (props: Partial<Parameters<typeof SkillMap>[0]> = {}) =>
    renderToStaticMarkup(createElement(SkillMap, { model: mixedModel(), now: NOW, onPin: noop, seriesFor: () => [], taughtSkillIds: [], ...props }))
  // The whole label, closing quote included: "Slides" (singing) begins "Slides into and out of notes" (guitar).
  const row = (skill: SkillDef) => `aria-label="Expand ${skill.name}"`
  const headings = (html: string) => [...html.matchAll(/<h3[^>]*>([^<]*)<\/h3>/g)].map((m) => m[1])

  it('left alone it draws the guitar: its six cards and every guitar skill, no singing skill', () => {
    const html = draw()
    expect(headings(html)).toEqual(GUITAR_CATEGORIES.map((c) => CATEGORY_LABELS[c]))
    for (const skill of SKILLS) expect(html.includes(row(skill))).toBe(true)
    for (const skill of VOICE_SKILLS) expect(html.includes(row(skill))).toBe(false)
  })

  it('given the singing skills it draws their three cards and no guitar skill', () => {
    const html = draw({ skills: VOICE_SKILLS, course: VOICE_COURSE })
    expect(headings(html)).toEqual(VOICE_CATEGORIES.map((c) => CATEGORY_LABELS[c]))
    for (const skill of VOICE_SKILLS) expect(html.includes(row(skill))).toBe(true)
    for (const skill of SKILLS) expect(html.includes(row(skill))).toBe(false)
  })

  it('a step skill shows its step where a tempo skill shows nothing in plain mode, and never a ceiling', () => {
    const html = draw({ skills: VOICE_SKILLS, course: VOICE_COURSE })
    expect(html.includes('now: all your easy notes')).toBe(true)
    expect(html.includes('now: 6 beats')).toBe(true)
    expect(/ceiling|bpm/.test(html)).toBe(false)
  })

  it('what is locked is worked out inside the instrument: a strong guitar skill opens no singing skill', () => {
    const html = draw({ skills: VOICE_SKILLS, course: VOICE_COURSE, model: { ...mixedModel(), skills: { [SKILLS[0].id]: state(SKILLS[0].id, 95) } } })
    // "Hold a note steady" builds on "Match a note", which this singer has not sung yet.
    expect(html.includes('first get better at: Match a note')).toBe(true)
  })

  it('a skill the singer has begun, one tier above what they can already do, is open, as on the guitar map', () => {
    // "Step up and down" (tier 1) is under way, so "Small jumps" (tier 2), once begun, is not held back
    // by the skills under it. Reckoned among the guitar's skills there would be nothing under way at all.
    const singer = { ...mixedModel(), skills: { 'voice.pitch.steps': state('voice.pitch.steps', 30), 'voice.interval.thirds': state('voice.interval.thirds', 10) } }
    const html = draw({ skills: VOICE_SKILLS, course: VOICE_COURSE, model: singer })
    expect(html.includes('<span class="text-sm font-medium">Small jumps</span>')).toBe(true)
    // One that was never begun stays locked.
    expect(html.includes('<span class="text-sm font-medium text-muted">Bigger jumps</span>')).toBe(true)
  })

  it('prints the score beside each bar, as the guitar map always did', () => {
    const html = draw()
    expect(html.includes('tabular-nums text-slate-300">95</span>')).toBe(true)
    expect(html.includes('tabular-nums text-slate-300">78</span>')).toBe(true)
  })

  it('can leave the score out: the bar and its word stay, the number is still there for a screen reader', () => {
    const html = draw({ skills: VOICE_SKILLS, course: VOICE_COURSE, scores: false })
    expect(/tabular-nums text-slate-300">\d+<\/span>/.test(html)).toBe(false)
    expect(html.includes('aria-valuenow="80"')).toBe(true)
    expect(html.includes('>Strong</span>')).toBe(true)
    // With the scores asked for, the singing map prints them too.
    expect(draw({ skills: VOICE_SKILLS, course: VOICE_COURSE }).includes('tabular-nums text-slate-300">80</span>')).toBe(true)
  })

  it('the step it shows is held to what the singer\'s range has room for', () => {
    const singer = { ...mixedModel(), skills: { 'voice.range.slides': state('voice.range.slides', 60, { step: 2 }), 'voice.pitch.match': state('voice.pitch.match', 80, { step: 2 }) } }
    const wide = draw({ skills: VOICE_SKILLS, course: VOICE_COURSE, model: singer })
    expect(wide.includes('now: up to note 8')).toBe(true)
    const narrow = draw({ skills: VOICE_SKILLS, course: VOICE_COURSE, model: singer, maxSteps: voiceMaxSteps({ low: 48, high: 55 }) })
    expect(narrow.includes('now: up to note 8')).toBe(false)
    expect(narrow.includes('now: up to note 5')).toBe(true)
    // A ladder that needs no room is not cut short by a small range.
    expect(narrow.includes('now: all your easy notes')).toBe(true)
  })

  describe('what opens under a skill', () => {
    const hold = VOICE_SKILLS.find((s) => s.id === 'voice.pitch.hold') as SkillDef
    const series = [
      { at: NOW - 3 * 86_400_000, rating: 41 },
      { at: NOW - 86_400_000, rating: 63 },
    ]
    const details = (props: Partial<Parameters<typeof SkillDetails>[0]> = {}) => renderToStaticMarkup(createElement(SkillDetails, { skill: hold, series, ...props }))

    it('is the description, the tips and the chart of the rating over time, as the guitar map always had', () => {
      const html = details({ skill: SKILLS[0] })
      expect(html.includes(SKILLS[0].description)).toBe(true)
      expect(SKILLS[0].tips.length).toBeGreaterThan(0)
      expect(html.split('<li>').length - 1).toBe(SKILLS[0].tips.length)
      expect(html.includes('<svg')).toBe(true)
      expect(html.includes('Rating over time, from 41 to 63')).toBe(true)
    })

    it('without the scores there is no chart: its grid is labelled in ratings, numbers the singing side keeps off the screen', () => {
      const html = details({ scores: false })
      expect(html.includes('<svg')).toBe(false)
      expect(/rating/i.test(html)).toBe(false)
      // The words stay.
      expect(html.includes(hold.description)).toBe(true)
      expect(html.includes('<li>')).toBe(hold.tips.length > 0)
    })

    it('without the scores a skill with too little history says nothing about data either', () => {
      expect(details({ scores: false, series: [] }).includes('Not enough data')).toBe(false)
      expect(details({ series: [] }).includes('Not enough data yet')).toBe(true)
    })
  })

  it('a skill a finished singing lesson taught is open, though what it builds on is not solid yet', () => {
    const fresh = { ...mixedModel(), skills: {} }
    const locked = draw({ skills: VOICE_SKILLS, course: VOICE_COURSE, model: fresh })
    expect(locked.includes('<span class="text-sm font-medium text-muted">Step up and down</span>')).toBe(true)
    const taught = draw({ skills: VOICE_SKILLS, course: VOICE_COURSE, model: fresh, taughtSkillIds: ['voice.pitch.steps'] })
    expect(taught.includes('<span class="text-sm font-medium">Step up and down</span>')).toBe(true)
  })
})
