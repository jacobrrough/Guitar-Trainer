import { describe, expect, it } from 'vitest'
import { skillById } from '../../training/instruments'
import { SKILLS_BY_ID } from '../../training/skills'
import type { Attempt, Block, ExerciseBlock, Recommendation, SessionRecord, SkillDef, SongBlock } from '../../training/types'
import { VOICE_SKILLS } from '../../training/voiceSkills'
import { SUNG_BLOCK, VOICE_DAY, todayCopy } from './copy'
import {
  MINUTE_OPTIONS,
  adviceAction,
  allFinished,
  attemptForBlock,
  blockPaceText,
  blockPath,
  blockTitle,
  milestonesSeenKey,
  minuteOptionsFor,
  notesHitText,
  reasonText,
  shownMinutes,
  simpleBandLabel,
  stepLabel,
  timingWords,
  minutesThisWeek,
  noneDone,
  pct,
  repSummaryText,
  streakText,
  timingText,
} from './todayUtils'

const exBlock = {
  id: 'b1',
  kind: 'focus',
  status: 'pending',
  minutes: 5,
  skillId: 'nope',
  generatorId: 'x',
  params: { tempo: 80, bars: 4 },
  tempo: 80,
  reps: 3,
  reason: '',
} as Block

describe('todayUtils', () => {
  it('sums minutes', () => {
    expect(minutesThisWeek([{ durationSec: 90 }, { durationSec: 150 }])).toBe(4)
    expect(minutesThisWeek([])).toBe(0)
  })

  it('formats percentages and streaks', () => {
    expect(pct(0.876)).toBe(88)
    expect(pct(2)).toBe(100)
    expect(streakText(0)).toBe('No streak yet')
    expect(streakText(3)).toContain('3-day streak')
  })

  it('titles blocks', () => {
    expect(blockTitle(exBlock)).toBe('nope · 80 bpm')
    expect(blockTitle(exBlock, undefined, true)).toBe('nope')
    const song = { id: 's', kind: 'song', status: 'pending', minutes: 5, songId: 2, level: 2, speed: 0.8, reason: '' } as Block
    expect(blockTitle(song, 'Demo')).toBe('Demo · Level 3 · 80% speed')
    expect(blockTitle({ ...song, speed: 1 } as Block, 'Demo')).toBe('Demo · Level 3')
    const test = { id: 't', kind: 'test', status: 'pending', minutes: 6, test: 'checkpoint', reason: '' } as Block
    // A name a learner can read, not the internal type.
    expect(blockTitle(test)).toBe('Weekly skill check')
    expect(blockTitle({ ...test, test: 'monthly' } as Block)).toBe('Monthly skill check')
    // Ear training has no tempo to show.
    expect(blockTitle({ ...exBlock, kind: 'ear' } as Block)).toBe('nope')
  })

  it('describes timing and reps', () => {
    expect(timingText(null)).toContain('not enough')
    expect(timingText(2)).toContain('on the beat')
    expect(timingText(24.4)).toBe('timing: +24 ms (late)')
    expect(timingText(-18)).toBe('timing: -18 ms (early)')
    expect(repSummaryText({ perfects: 5, goods: 2, misses: 1 })).toBe('5 perfect · 2 good · 1 missed')
  })

  it('uses plain words', () => {
    expect(notesHitText({ perfects: 4, goods: 2, total: 8 })).toBe('6 of 8 notes')
    expect(timingWords(60)).toBe('a little behind the click')
    expect(timingWords(-60)).toBe('a little ahead of the click')
    expect(timingWords(3)).toBe('right with the click')
    expect(simpleBandLabel('developing')).toBe('Solid')
    expect(reasonText('timing bias')).toBe('your timing drifted')
    expect(blockPaceText(exBlock)).toContain('steady')
  })

  it('tracks session completion', () => {
    const mk = (statuses: Block['status'][]) =>
      ({ plan: { blocks: statuses.map((status) => ({ ...exBlock, status })) } }) as unknown as SessionRecord
    expect(allFinished(mk(['done', 'skipped']))).toBe(true)
    expect(allFinished(mk(['done', 'pending']))).toBe(false)
    expect(noneDone(mk(['skipped', 'pending']))).toBe(true)
    expect(noneDone(mk(['done']))).toBe(false)
  })

  it('finds the latest attempt of a block', () => {
    const at = (over: Partial<Attempt>) => ({ at: 1, sessionId: 7, skillId: 'nope', ...over }) as Attempt
    const list = [at({ at: 1, accuracy: 0.5 }), at({ at: 5, accuracy: 0.9 }), at({ at: 9, sessionId: 8 })]
    expect(attemptForBlock(list, 7, exBlock)?.accuracy).toBe(0.9)
    expect(attemptForBlock(list, undefined, exBlock)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------------------------------
// Two instruments. Everything above is the guitar as it was before singing; none of it was edited.
// ---------------------------------------------------------------------------------------------------

const skillOf = (id: string): SkillDef => {
  const skill = skillById(id)
  if (!skill) throw new Error(`no skill ${id}`)
  return skill
}

/** A block of a singing plan, as the Coach stores one. */
const sung = (skillId: string, over: Partial<ExerciseBlock> = {}): ExerciseBlock => {
  const skill = skillOf(skillId)
  return {
    id: 'voice-2026-11-23-1-focus',
    kind: 'focus',
    status: 'pending',
    minutes: 4,
    skillId,
    generatorId: skill.generators[0],
    params: { tempo: skill.startTempo, bars: 8, ...(skill.steps ? { step: 0, startStep: 0 } : {}) },
    tempo: skill.startTempo,
    reps: 3,
    reason: '',
    ...over,
  }
}
const sungSong = (over: Partial<SongBlock> = {}): SongBlock => ({ id: 'voice-2026-11-23-2-song', kind: 'song', status: 'pending', minutes: 4, songId: 31, level: 0, speed: 1, reason: '', ...over })

/**
 * Words a singer is never shown: the guitar's, the unkind ones, and numbers a beginner cannot use.
 * ("Chord" is not among them: one singing skill is called "Chord notes up to the top".)
 */
const NOT_FOR_A_SINGER = /\b(play\w*|guitars?|strings?|frets?|strum\w*|pick\w*|tun(e|ing) up|metronome|wrong|fail\w*|tone.?deaf|loud\w*|push\w*|belt\w*|cents?|ratings?|tiers?|reps?)\b/i
const STEP_SKILLS = VOICE_SKILLS.filter((s) => (s.steps?.length ?? 0) > 0)
const TEMPO_SKILLS = VOICE_SKILLS.filter((s) => (s.steps?.length ?? 0) === 0)

describe('blockTitle: a title for the blocks of both instruments', () => {
  it('finds the name of a singing skill (the guitar list does not hold it)', () => {
    expect(blockTitle(sung('voice.pitch.steps'), undefined, true)).toBe('Step up and down')
    expect(blockTitle(sung('voice.pitch.match'), undefined, true)).toBe('Match a note')
  })

  it('still finds every guitar skill, with its tempo', () => {
    const chromatic = { ...exBlock, skillId: 'fret.chromatic', tempo: 72 } as Block
    expect(blockTitle(chromatic)).toBe(`${SKILLS_BY_ID['fret.chromatic'].name} · 72 bpm`)
  })

  it('names the step of a step skill where a tempo would stand: its tempo never changes and says nothing', () => {
    expect(blockTitle(sung('voice.pitch.hold'))).toBe('Hold a note steady · 4 beats')
    expect(blockTitle(sung('voice.pitch.hold', { params: { tempo: 60, bars: 8, step: 2 } }))).toBe('Hold a note steady · 8 beats')
    for (const skill of STEP_SKILLS) {
      for (let step = 0; step < skill.steps!.length; step++) {
        const title = blockTitle(sung(skill.id, { params: { tempo: skill.startTempo, bars: 8, step } }))
        expect(title).toBe(`${skill.name} · ${skill.steps![step].label}`)
        expect(title).not.toMatch(/bpm/)
      }
    }
  })

  it('reads a stored step that is past the end of the ladder, or no number, as a step that exists', () => {
    expect(blockTitle(sung('voice.pitch.hold', { params: { tempo: 60, bars: 8, step: 99 } }))).toBe('Hold a note steady · 8 beats, right on the note')
    expect(blockTitle(sung('voice.pitch.hold', { params: { tempo: 60, bars: 8 } }))).toBe('Hold a note steady · 4 beats')
  })

  it('keeps the tempo on a singing skill that gets faster', () => {
    expect(blockTitle(sung('voice.pitch.steps', { tempo: 63.2 }))).toBe('Step up and down · 63 bpm')
  })

  it('names the level of a song to sing by its name, and never a speed', () => {
    expect(blockTitle(sungSong(), 'Hot Cross Buns')).toBe('Hot Cross Buns · Echo each line')
    expect(blockTitle(sungSong({ level: 2 }), 'Hot Cross Buns', true)).toBe('Hot Cross Buns · Whole tune')
    // A sung song is never slowed down; a stored speed must not be shown as if it were.
    expect(blockTitle(sungSong({ level: 5, speed: 0.75 }), 'Ode to Joy')).toBe('Ode to Joy · Performance')
    // A level outside the six is the nearest one, never a blank.
    expect(blockTitle(sungSong({ level: 9 }), 'Ode to Joy')).toBe('Ode to Joy · Performance')
  })

  it("calls a singer's check what the check page calls it", () => {
    const check = { id: 'voice-2026-11-23-3-test', kind: 'test', status: 'pending', minutes: 5, test: 'checkpoint', reason: '' } as Block
    expect(blockTitle(check)).toBe('Your weekly check')
  })
})

describe('blockPaceText: the line under the title', () => {
  it('tells a singer to sing, at the same three paces', () => {
    expect(blockPaceText(sung('voice.pitch.steps', { tempo: 60 }))).toBe('Sing it slowly, with the clicks')
    expect(blockPaceText(sung('voice.pitch.steps', { tempo: 80 }))).toBe('At a steady pace, with the clicks')
    expect(blockPaceText(sung('voice.pitch.runs', { tempo: 120 }))).toBe('At a lively pace, with the clicks')
  })

  it('names the first step of a step skill: slow or lively says nothing about it', () => {
    expect(blockPaceText(sung('voice.pitch.hold'))).toBe('First round: 4 beats')
    expect(blockPaceText(sung('voice.range.slides', { params: { tempo: 60, bars: 8, step: 1 } }))).toBe('First round: up to note 5')
    for (const skill of STEP_SKILLS) expect(blockPaceText(sung(skill.id))).toBe(`First round: ${skill.steps![0].label}`)
  })

  it('still tells a guitarist to play', () => {
    expect(blockPaceText({ ...exBlock, skillId: 'fret.chromatic', tempo: 60 } as Block)).toBe('Play it slowly, with the clicks')
    expect(blockPaceText({ ...exBlock, skillId: 'fret.chromatic', tempo: 110 } as Block)).toBe('At a lively pace, with the clicks')
  })

  it('has nothing to say about a song or a check', () => {
    expect(blockPaceText(sungSong())).toBeNull()
  })
})

describe('what a singer reads on the plan: no guitar words, nothing unkind', () => {
  it('holds for every title and pace line of every singing skill, at every step and pace', () => {
    for (const skill of VOICE_SKILLS) {
      const steps = skill.steps?.length ?? 1
      for (let step = 0; step < steps; step++) {
        for (const tempo of [skill.minTempo ?? skill.startTempo, skill.startTempo, skill.targetTempo]) {
          const block = sung(skill.id, { tempo, params: { tempo, bars: 8, ...(skill.steps ? { step } : {}) } })
          for (const simple of [true, false]) {
            const texts = [blockTitle(block, undefined, simple), blockPaceText(block) ?? '']
            for (const text of texts) expect(text, `${skill.id}: ${text}`).not.toMatch(NOT_FOR_A_SINGER)
            // A step skill has one tempo for good: a number of beats per minute says nothing about it.
            if (skill.steps) for (const text of texts) expect(text, `${skill.id}: ${text}`).not.toMatch(/bpm/i)
          }
        }
      }
    }
    for (let level = 0; level < 6; level++) expect(blockTitle(sungSong({ level }), 'Mary Had a Little Lamb')).not.toMatch(NOT_FOR_A_SINGER)
  })

  it('has both kinds of singing skill to check', () => {
    expect(STEP_SKILLS.length).toBeGreaterThan(0)
    expect(TEMPO_SKILLS.length).toBeGreaterThan(0)
  })
})

describe('stepLabel: the step a round is on, in the words of its skill', () => {
  it('is the label of the step', () => {
    expect(stepLabel(skillOf('voice.pitch.hold'), 1)).toBe('6 beats')
    expect(stepLabel(skillOf('voice.pitch.match'), 0)).toBe('close notes')
  })

  it('is nothing for a skill that moves by tempo: every guitar skill, and some singing ones', () => {
    expect(stepLabel(skillOf('voice.pitch.steps'), 0)).toBeNull()
    expect(stepLabel(SKILLS_BY_ID['fret.chromatic'], 2)).toBeNull()
    expect(stepLabel(undefined, 0)).toBeNull()
  })

  it('keeps a stored step inside the ladder', () => {
    const hold = skillOf('voice.pitch.hold')
    expect(stepLabel(hold, -3)).toBe('4 beats')
    expect(stepLabel(hold, 99)).toBe('8 beats, right on the note')
    expect(stepLabel(hold, 'two')).toBe('4 beats')
    expect(stepLabel(hold, 1.9)).toBe('6 beats')
  })
})

describe('minutes a day', () => {
  it('offers a guitarist the four lengths there always were', () => {
    expect(minuteOptionsFor('guitar')).toEqual([10, 20, 30, 45])
    expect(minuteOptionsFor('guitar')).toBe(MINUTE_OPTIONS)
  })

  it('offers a singer 10, 20 or 30: there is no longer singing day', () => {
    expect(minuteOptionsFor('voice')).toEqual([10, 20, 30])
  })

  it('marks the length the Coach will really plan', () => {
    // A singing profile that says 45 gets the 30-minute day, so that is the button that is lit.
    expect(shownMinutes(45, minuteOptionsFor('voice'))).toBe(30)
    for (const m of [10, 20, 30] as const) expect(shownMinutes(m, minuteOptionsFor('voice'))).toBe(m)
    for (const m of MINUTE_OPTIONS) expect(shownMinutes(m, minuteOptionsFor('guitar'))).toBe(m)
  })
})

describe('milestonesSeenKey: where "seen up to here" is remembered', () => {
  it('is the key it always was for the guitar, and another one for singing', () => {
    expect(milestonesSeenKey('guitar')).toBe('gt.milestonesSeenAt')
    expect(milestonesSeenKey('voice')).toBe('gt.milestonesSeenAt.voice')
  })
})

describe('blockPath: where "Start" on a block leads', () => {
  it('opens an exercise or a song in the block runner', () => {
    expect(blockPath(exBlock)).toBe('/today/block/b1')
    expect(blockPath(sung('voice.pitch.match'))).toBe('/today/block/voice-2026-11-23-1-focus')
    expect(blockPath(sungSong())).toBe('/today/block/voice-2026-11-23-2-song')
  })

  it("opens a guitarist's check as it always did", () => {
    for (const test of ['placement', 'checkpoint', 'monthly'] as const) {
      expect(blockPath({ id: 't', kind: 'test', status: 'pending', minutes: 6, test, reason: '' })).toBe(`/test/${test}`)
    }
  })

  it("opens a singer's check as a singer's, whatever the switch says by then", () => {
    expect(blockPath({ id: 'voice-2026-11-23-3-test', kind: 'test', status: 'pending', minutes: 5, test: 'checkpoint', reason: '' })).toBe('/test/checkpoint?instrument=voice')
  })
})

describe('adviceAction: the button on a card of advice', () => {
  const rec = (action: Recommendation['action'], id = 'x'): Recommendation => ({ id, priority: 1, title: 't', reason: 'r', action })
  const blocks: Block[] = [exBlock, { ...exBlock, id: 'b2', skillId: 'done-skill', status: 'done' } as Block]

  it('is what it always was for a guitarist', () => {
    expect(adviceAction(rec({ type: 'calibrate' }), 'guitar', blocks)).toEqual({ label: 'Calibrate', to: '/settings?calibrate=1' })
    expect(adviceAction(rec({ type: 'song', songId: 7, level: 2, speed: 0.85 }), 'guitar', blocks)).toEqual({ label: 'Play song', to: '/play/7' })
    expect(adviceAction(rec({ type: 'test', test: 'monthly' }), 'guitar', blocks)).toEqual({ label: 'Start test', to: '/test/monthly' })
    expect(adviceAction(rec({ type: 'practice', skillId: 'nope', tempo: 80 }), 'guitar', blocks)).toEqual({ label: 'Go to block', to: '/today/block/b1' })
    expect(adviceAction(rec({ type: 'rest' }), 'guitar', blocks)).toBeNull()
    expect(adviceAction(rec({ type: 'mic' }), 'guitar', blocks)).toBeNull()
    expect(adviceAction(rec(undefined), 'guitar', blocks)).toBeNull()
  })

  it('offers practice only while a block of that skill is still to do', () => {
    expect(adviceAction(rec({ type: 'practice', skillId: 'done-skill' }), 'guitar', blocks)).toBeNull()
    expect(adviceAction(rec({ type: 'practice', skillId: 'other' }), 'guitar', blocks)).toBeNull()
    expect(adviceAction(rec({ type: 'practice', skillId: 'nope' }), 'guitar', undefined)).toBeNull()
  })

  it('sends a singer to the song page for singing, on the level the card is about', () => {
    expect(adviceAction(rec({ type: 'song', songId: 31, level: 3, speed: 1 }), 'voice', [])).toEqual({ label: 'Sing', to: '/sing/31?level=3' })
    // Level 0 is a level: it stays in the address.
    expect(adviceAction(rec({ type: 'song', songId: 31, level: 0, speed: 1 }), 'voice', [])).toEqual({ label: 'Sing', to: '/sing/31?level=0' })
  })

  it('opens the song where it was last sung when the card is only about singing a song again', () => {
    // That card names a song, not a level: its level is a stand-in.
    expect(adviceAction(rec({ type: 'song', songId: 31, level: 1, speed: 1 }, 'play-music'), 'voice', [])).toEqual({ label: 'Sing', to: '/sing/31' })
  })

  it("opens a singer's weekly check as a singer's, and offers no other check", () => {
    expect(adviceAction(rec({ type: 'test', test: 'checkpoint' }), 'voice', [])).toEqual({ label: 'Start the check', to: '/test/checkpoint?instrument=voice' })
    expect(adviceAction(rec({ type: 'test', test: 'monthly' }), 'voice', [])).toBeNull()
    expect(adviceAction(rec({ type: 'test', test: 'placement' }), 'voice', [])).toBeNull()
  })

  it('has no sound-sync button for a singer: a sung result does not depend on it', () => {
    expect(adviceAction(rec({ type: 'calibrate' }), 'voice', [])).toBeNull()
  })

  it('takes a singer to the block of a step exercise, which carries no tempo', () => {
    const plan: Block[] = [sung('voice.pitch.hold')]
    expect(adviceAction(rec({ type: 'practice', skillId: 'voice.pitch.hold' }, 'step-ratchet'), 'voice', plan)).toEqual({ label: 'Go to block', to: '/today/block/voice-2026-11-23-1-focus' })
  })

  it('never says "play" to a singer', () => {
    const actions: Recommendation['action'][] = [{ type: 'song', songId: 1, level: 1, speed: 1 }, { type: 'test', test: 'checkpoint' }, { type: 'practice', skillId: 'voice.pitch.hold' }]
    for (const action of actions) {
      const label = adviceAction(rec(action), 'voice', [sung('voice.pitch.hold')])?.label ?? ''
      expect(label).not.toMatch(NOT_FOR_A_SINGER)
    }
  })
})

describe('todayCopy: the words of Today for each instrument', () => {
  /** Every string in a copy object, however deep; functions are called with a plain number. */
  const strings = (value: unknown): string[] => {
    if (typeof value === 'string') return [value]
    if (typeof value === 'function') return strings((value as (n: number) => unknown)(12))
    if (Array.isArray(value)) return value.flatMap(strings)
    if (value && typeof value === 'object') return Object.values(value).flatMap(strings)
    return []
  }

  it("keeps a guitarist's words as they were", () => {
    const copy = todayCopy('guitar')
    expect(copy.tools).toEqual([
      { to: '/tune', label: 'Tune up' },
      { to: '/metronome', label: 'Metronome' },
      { to: '/lessons', label: 'All lessons and songs' },
    ])
    expect(copy.skip.lead).toBe('Played before?')
    expect(copy.skip.link).toBe('Skip the course and go to daily sessions')
    expect(copy.skip.title).toBe('Skip the First steps course?')
    expect(copy.skip.body).toEqual([
      'You will go straight to daily practice sessions. They expect that you can already hold the guitar, tune it and play a few notes.',
      'Nothing is lost. The lessons stay on this page, under “First steps lessons”, and you can carry on with them any time.',
    ])
    expect(copy.complete.action).toBe('Play a song')
    expect(copy.complete.body(12)).toBe('You practised 12 minutes today. Nice work.')
  })

  it('gives a singer their own tools: the easy notes, and no tuner or metronome', () => {
    expect(todayCopy('voice').tools).toEqual([
      { to: '/range', label: 'Find my easy notes' },
      { to: '/lessons', label: 'All lessons and songs' },
    ])
  })

  it('asks a singer about singing before the course is skipped', () => {
    const skip = todayCopy('voice').skip
    expect(skip.lead).toBe('Sung before?')
    expect(skip.title).toBe('Skip the First steps course?')
    expect(skip.body.join(' ')).toMatch(/sing/)
    // The same promise as for a guitarist: nothing is lost.
    expect(skip.body.join(' ')).toMatch(/Nothing is lost/)
  })

  it('says nothing about a guitar to a singer, and nothing unkind', () => {
    for (const text of [...strings(todayCopy('voice')), ...strings(VOICE_DAY), ...strings(SUNG_BLOCK)]) expect(text, text).not.toMatch(NOT_FOR_A_SINGER)
  })

  it('has the care lines a singing day needs', () => {
    expect(VOICE_DAY.water).toBe('Have some water nearby.')
    expect(VOICE_DAY.care).toBe('Singing should never hurt. If your throat feels sore, scratchy or tired, stop for today.')
    expect(VOICE_DAY.tired.button).toBe('My voice is tired')
    // Ending the day early costs nothing, and the singer is told so before they decide.
    expect(strings(VOICE_DAY.tired.ask).join(' ')).toMatch(/Nothing is lost/)
  })

  it('never says "bpm", "accuracy" or "score" on a singing day', () => {
    for (const text of [...strings(todayCopy('voice')), ...strings(VOICE_DAY), ...strings(SUNG_BLOCK)]) expect(text, text).not.toMatch(/\b(bpm|accuracy|scores?)\b/i)
  })
})

describe('edges of what a singer is shown on the plan', () => {
  it('lights a length that is on offer whatever the profile says: never none', () => {
    // A row from a backup made by hand, or by a later version with a shorter day.
    expect(shownMinutes(5, minuteOptionsFor('voice'))).toBe(10)
    expect(shownMinutes(25, minuteOptionsFor('voice'))).toBe(20)
    expect(shownMinutes(Number.NaN, minuteOptionsFor('voice'))).toBe(10)
    expect(shownMinutes(Number.NaN, minuteOptionsFor('guitar'))).toBe(10)
    expect(shownMinutes(600, minuteOptionsFor('guitar'))).toBe(45)
  })

  it('names a level of a song to sing whatever number the block carries', () => {
    for (const level of [Number.NaN, -1, 0.4, undefined as unknown as number]) {
      expect(blockTitle(sungSong({ level }), 'Ode to Joy'), String(level)).toBe('Ode to Joy · Echo each line')
    }
    expect(blockTitle(sungSong({ level: 4.6 }), 'Ode to Joy')).toBe('Ode to Joy · Performance')
    // And a title that has not been read yet is not "undefined".
    expect(blockTitle(sungSong({ level: 1 }))).toBe('Song #31 · Echo two lines')
  })

  it("keeps a guitarist's song block as it was, also on its first level and at full speed", () => {
    const song = { id: 'b3', kind: 'song', status: 'pending', minutes: 5, songId: 7, level: 0, speed: 1, reason: '' } as Block
    expect(blockTitle(song, 'Smoke')).toBe('Smoke · Level 1')
    expect(blockTitle({ ...song, speed: 0.75 } as Block, 'Smoke')).toBe('Smoke · Level 1 · 75% speed')
  })

  it('reads whose block it is from the start of its id, not from anywhere in it', () => {
    const check = { id: 'x-voice-1-test', kind: 'test', status: 'pending', minutes: 5, test: 'checkpoint', reason: '' } as Block
    expect(blockTitle(check)).toBe('Weekly skill check')
    expect(blockPath(check)).toBe('/test/checkpoint')
  })

  it('offers a singer practice only on a block that is still to do, never on a song or a check of the plan', () => {
    const rec = (action: Recommendation['action']): Recommendation => ({ id: 'step-fallback', priority: 1, title: 't', reason: 'r', action })
    const done = sung('voice.pitch.hold', { status: 'done' })
    const open = sung('voice.pitch.hold', { id: 'voice-2026-11-23-4-review', kind: 'review' })
    expect(adviceAction(rec({ type: 'practice', skillId: 'voice.pitch.hold' }), 'voice', [done])).toBeNull()
    expect(adviceAction(rec({ type: 'practice', skillId: 'voice.pitch.hold' }), 'voice', [sungSong(), done, open])).toEqual({ label: 'Go to block', to: '/today/block/voice-2026-11-23-4-review' })
  })
})
