import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFAULT_RANGES } from '../../music/keys'
import { VOICE_LEVELS } from '../../songs/vocal/levels'
import { meetsCriteria } from '../../training/assessment'
import { TEST_PASS, VOICE_TEST_PASS } from '../../training/constants'
import { SKILLS } from '../../training/skills'
import type { AttemptResult, LearnerModel, SkillDef, SkillState, TestRecord, TestTask, TestType } from '../../training/types'
import { VOICE_SKILLS } from '../../training/voiceSkills'
import { TaskCard, TaskIntro, TaskResultCard } from './TaskIntro'
import { TestReportView } from './TestReportView'
import {
  checkInstrument,
  checkOffered,
  checkWords,
  estimateMinutes,
  failedCriteria,
  failureReasons,
  focusSkillFor,
  passRuleText,
  ruleAccuracy,
  shownAccuracyPct,
  singingRange,
  sungSongStep,
  taskPace,
  verdictBadge,
} from './taskResult'

function result(partial: Partial<AttemptResult> = {}): AttemptResult {
  return {
    perfects: 16,
    goods: 0,
    misses: 0,
    total: 16,
    timingMedianMs: 4,
    timingStdevMs: 20,
    coverage: 1,
    durationSec: 30,
    playedTempo: 70,
    targetTempo: 70,
    speed: 1,
    ...partial,
  }
}

describe('task result: the card shows what the pass rule uses', () => {
  it('every note hit a little off: 80%, not 100%, and the reason is accuracy', () => {
    // All 16 notes inside the "good" window, none "perfect": hits / notes is 100%, the rule counts 80%.
    const r = result({ perfects: 0, goods: 16, timingMedianMs: 20, timingStdevMs: 25 })
    expect(meetsCriteria(TEST_PASS, r)).toBe(false)
    expect(shownAccuracyPct(ruleAccuracy(r), TEST_PASS.minAccuracy)).toBe(80)
    expect(failedCriteria(TEST_PASS, r)).toEqual(['accuracy'])
    expect(verdictBadge(failedCriteria(TEST_PASS, r))).toBe('accuracy below target')
    expect(failureReasons(TEST_PASS, r)).toEqual([
      'Accuracy: you scored 80%, and 85% is needed. A note that is a little early or late counts as 80% of a note, and 16 of yours were.',
    ])
  })

  it('names timing when the notes were clean but late', () => {
    const r = result({ timingMedianMs: 42 })
    expect(meetsCriteria(TEST_PASS, r)).toBe(false)
    expect(failedCriteria(TEST_PASS, r)).toEqual(['timing'])
    expect(failureReasons(TEST_PASS, r)[0]).toBe('Timing: most of your notes came after the beat, by about 42 ms. 30 ms or less is needed.')
    expect(failureReasons(TEST_PASS, result({ timingMedianMs: -38 }))[0]).toContain('before the beat, by about 38 ms')
  })

  it('names steadiness when the notes were scattered', () => {
    const r = result({ timingStdevMs: 75 })
    expect(failedCriteria(TEST_PASS, r)).toEqual(['spread'])
    expect(verdictBadge(['spread'])).toBe('timing not steady')
    expect(failureReasons(TEST_PASS, r)[0]).toContain('spread 75 ms')
  })

  it('names every part that was missed', () => {
    const r = result({ perfects: 4, goods: 4, misses: 8, timingMedianMs: -50, timingStdevMs: 90 })
    expect(failedCriteria(TEST_PASS, r)).toEqual(['accuracy', 'timing', 'spread'])
    expect(failureReasons(TEST_PASS, r)).toHaveLength(3)
    expect(verdictBadge(failedCriteria(TEST_PASS, r))).toBe('accuracy below target · timing off target · timing not steady')
  })

  it('says on target, with no reasons, when the task is passed', () => {
    const r = result({ perfects: 14, goods: 2 })
    expect(meetsCriteria(TEST_PASS, r)).toBe(true)
    expect(failedCriteria(TEST_PASS, r)).toEqual([])
    expect(verdictBadge([])).toBe('on target')
    expect(failureReasons(TEST_PASS, r)).toEqual([])
    expect(shownAccuracyPct(ruleAccuracy(r), TEST_PASS.minAccuracy)).toBe(98)
  })

  it('never rounds a failing accuracy up to the pass mark', () => {
    expect(shownAccuracyPct(0.848, 0.85)).toBe(84)
    expect(shownAccuracyPct(0.85, 0.85)).toBe(85)
    expect(shownAccuracyPct(0.4, 0.85)).toBe(40)
    expect(shownAccuracyPct(0, 0.85)).toBe(0)
  })

  it('agrees with the pass rule for every mix of notes and timing', () => {
    const timings = [null, -45, -30, 0, 30, 31]
    const spreads = [null, 20, 60, 61]
    for (let perfects = 0; perfects <= 16; perfects += 2) {
      for (let goods = 0; perfects + goods <= 16; goods += 2) {
        for (const timingMedianMs of timings) {
          for (const timingStdevMs of spreads) {
            const r = result({ perfects, goods, misses: 16 - perfects - goods, timingMedianMs, timingStdevMs })
            expect(failedCriteria(TEST_PASS, r).length === 0).toBe(meetsCriteria(TEST_PASS, r))
          }
        }
      }
    }
  })

  it('states the rule before the task with the numbers the task uses', () => {
    expect(passRuleText(TEST_PASS)).toBe('To pass: 85% accuracy with steady timing. A note that is a little early or late counts as 80% of a note.')
    expect(passRuleText({ ...TEST_PASS, minAccuracy: 0.7 })).toContain('70% accuracy')
  })
})

/** What a learner reads of a drawn component: its text, one piece per element. */
function textOf(html: string): string[] {
  return html
    .split(/<[^>]*>/)
    .map((piece) => piece.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').trim())
    .filter((piece) => piece !== '')
}

const noop = () => {}
const voiceSkill = (id: string) => VOICE_SKILLS.find((s) => s.id === id) as SkillDef
const HOLD = voiceSkill('voice.pitch.hold')
const STEPS = voiceSkill('voice.pitch.steps')

/** Tasks as `checkpointTasks` writes them: a guitar drill, a guitar song, and the three kinds a singer gets. */
const GUITAR_TASK: TestTask = {
  id: 'checkpoint-01',
  title: `Focus: ${SKILLS[0].name}`,
  instructions: `Play ${SKILLS[0].name} at 60 bpm.`,
  skillIds: [SKILLS[0].id],
  generatorId: 'melody',
  params: { tempo: 60.4, bars: 8 },
  difficulty: 10,
  passCriteria: TEST_PASS,
}
const GUITAR_SONG: TestTask = {
  ...GUITAR_TASK,
  id: 'checkpoint-03',
  title: 'Stretch: Ode to Joy (Level 3)',
  instructions: 'Play Ode to Joy at Level 3, full speed.',
  skillIds: [],
  generatorId: 'song',
  params: { tempo: 100, bars: 0, songId: 3, level: 2 },
}
const SUNG_STEP: TestTask = {
  id: 'checkpoint-01',
  title: `Focus: ${HOLD.name}`,
  instructions: `Sing ${HOLD.name}: 6 beats.`,
  skillIds: [HOLD.id],
  generatorId: 'voiceHold',
  params: { tempo: 60, bars: 8, step: 1 },
  difficulty: 30,
  passCriteria: VOICE_TEST_PASS,
}
const SUNG_TEMPO: TestTask = {
  ...SUNG_STEP,
  id: 'checkpoint-02',
  title: `Retention: ${STEPS.name}`,
  instructions: `Sing ${STEPS.name} at 66 bpm.`,
  skillIds: [STEPS.id],
  generatorId: 'voicePattern',
  params: { tempo: 66, bars: 8 },
}
const SUNG_SONG: TestTask = {
  ...SUNG_STEP,
  id: 'checkpoint-03',
  title: 'Stretch: Mary Had a Little Lamb (Level 3)',
  instructions: 'Sing Mary Had a Little Lamb at Level 3.',
  skillIds: [],
  generatorId: 'song',
  params: { tempo: 100, bars: 0, songId: 7, level: 2 },
}

function record(type: TestType, ratingDeltas: Record<string, number>, nextFocus: string[]): TestRecord {
  return { at: 1, type, tasks: [], results: [], report: { headline: 'Checkpoint: 1 of 2 passed', lines: ['Focus: X: passed', 'Retention: Y: not yet'], ratingDeltas, nextFocus } }
}

/** Nothing a singer reads may be about a guitar, or put in the words the singing side never uses. */
const NOT_FOR_A_SINGER = /guitar|strum|fret|\bplay|\bwrong|failed|tone deaf|louder|\bpush|\bbelt/i
/** Numbers a beginner cannot use. */
const NO_USE_TO_A_BEGINNER = /\bms\b|\bcents?\b|\brating/i

describe('the check screens for the guitar read as they always did', () => {
  const intro = (type: TestType, taskCount: number) => textOf(renderToStaticMarkup(createElement(TaskIntro, { type, taskCount, onStart: noop, onCancel: noop })))
  const RULES = [
    'Rules',
    'One attempt per task. There is no retry.',
    'No pausing or seeking once a task starts.',
    'Everything plays at full speed after a count-in.',
    'Nothing is saved unless you finish the test.',
    'Start',
    'Not now',
  ]

  it('the page before the first task', () => {
    expect(intro('checkpoint', 3)).toEqual([
      'Weekly checkpoint',
      'A focus task, a retention task and a song stretch to see what has moved since last time.',
      '3 tasks',
      '~2 min',
      'Mic required',
      ...RULES,
    ])
    expect(intro('placement', 9)).toEqual([
      'Placement test',
      'A ladder of short tasks that gets easier to harder. It stops after two misses in a row and sets your starting levels.',
      'Up to 9 tasks',
      '~5 min',
      'Mic required',
      ...RULES,
    ])
    expect(intro('monthly', 1)).toEqual([
      'Monthly assessment',
      'The ladder again, starting one tier below your level, to re-measure your skills.',
      '1 task',
      '~1 min',
      'Mic required',
      ...RULES,
    ])
  })

  it('the card of a task', () => {
    const rule = 'A count-in plays first. To pass: 85% accuracy with steady timing. A note that is a little early or late counts as 80% of a note.'
    expect(textOf(renderToStaticMarkup(createElement(TaskCard, { task: GUITAR_TASK, position: 1, total: 3, onPlay: noop })))).toEqual([
      'Task 1 of 3',
      'Skill task',
      'Focus: Open strings on the beat',
      'Play Open strings on the beat at 60 bpm.',
      'Target tempo',
      '60 bpm',
      'Measures',
      'Open strings on the beat',
      rule,
      'Play task',
    ])
    expect(textOf(renderToStaticMarkup(createElement(TaskCard, { task: GUITAR_SONG, position: 3, total: 3, onPlay: noop })))).toEqual([
      'Task 3 of 3',
      'Song stretch',
      'Stretch: Ode to Joy (Level 3)',
      'Play Ode to Joy at Level 3, full speed.',
      'Target tempo',
      '100 bpm',
      'Measures',
      'Song playing',
      rule,
      'Play task',
    ])
  })

  it('the result of a task, with its three numbers', () => {
    const late = result({ perfects: 12, goods: 4, timingMedianMs: 42, timingStdevMs: 20 })
    expect(textOf(renderToStaticMarkup(createElement(TaskResultCard, { task: GUITAR_TASK, passed: false, result: late, last: false, onNext: noop })))).toEqual([
      'Task result',
      'Focus: Open strings on the beat',
      'Not yet',
      'timing off target',
      'Accuracy',
      '95%',
      'Timing',
      '+42 ms',
      'Spread',
      '20 ms',
      'Timing: most of your notes came after the beat, by about 42 ms. 30 ms or less is needed.',
      'Next',
    ])
    expect(textOf(renderToStaticMarkup(createElement(TaskResultCard, { task: GUITAR_TASK, passed: true, result: result(), last: true, onNext: noop })))).toEqual([
      'Task result',
      'Focus: Open strings on the beat',
      'Passed',
      'on target',
      'Accuracy',
      '100%',
      'Timing',
      '+4 ms',
      'Spread',
      '20 ms',
      'See results',
    ])
  })

  it('the report', () => {
    const checkpoint = record('checkpoint', { [SKILLS[0].id]: 3.24, [SKILLS[1].id]: -1.5, [SKILLS[2].id]: 0 }, [SKILLS[1].id, 'gone.skill'])
    expect(
      textOf(renderToStaticMarkup(createElement(TestReportView, { record: checkpoint, notes: ['Stretch: Z: skipped (song not in your library)'], onHome: noop, onProgress: noop }))),
    ).toEqual([
      'Weekly checkpoint',
      'Results',
      'Checkpoint: 1 of 2 passed',
      'Focus: X: passed',
      'Retention: Y: not yet',
      'Stretch: Z: skipped (song not in your library)',
      'Rating changes',
      'Open strings on the beat',
      '+3.2',
      'First frets, one finger each',
      '-1.5',
      'Next focus',
      'First frets, one finger each',
      'gone.skill',
      'Back to Today',
      'See progress',
    ])
    const placement = record('placement', { [SKILLS[0].id]: 65, [SKILLS[1].id]: 0 }, [])
    const text = textOf(renderToStaticMarkup(createElement(TestReportView, { record: placement, onHome: noop, onProgress: noop })))
    expect(text.slice(0, 2)).toEqual(['Placement test', 'Results'])
    expect(text.slice(5, 8)).toEqual(['Starting ratings', 'Open strings on the beat', '0 → 65'])
  })

  it('the words kept beside the screens are the same ones', () => {
    const words = checkWords()
    expect(checkWords('guitar')).toBe(words)
    expect(words.leave).toBe('Leave the test? Your progress will not be saved.')
    expect(words.preparing).toBe('Preparing your test…')
    expect(words.nothing).toEqual({ title: 'Nothing to test yet', subtitle: 'Practise a few skills first, then come back.' })
    expect(words.noTasks).toBe('No tasks could be played, so nothing was saved.')
    expect(words.skipped('Stretch: Z')).toBe('Stretch: Z: skipped (song not in your library)')
    expect(words.trouble).toEqual({
      build: 'Could not build the test.',
      prepare: 'Could not prepare the task.',
      task: 'This task could not be generated.',
      save: 'Could not save the test.',
    })
    expect(estimateMinutes(3)).toBe(2)
    expect(estimateMinutes(0)).toBe(1)
  })
})

describe('whose check it is', () => {
  it('a link that asks for singing gets it, once the singing side is on', () => {
    expect(checkInstrument('voice', 'guitar', true)).toBe('voice')
    expect(checkInstrument('voice', 'voice', true)).toBe('voice')
  })

  it('a link that asks for singing gets the guitar while the singing side is off', () => {
    expect(checkInstrument('voice', 'guitar', false)).toBe('guitar')
  })

  it('with the singing side off every check is the guitar\'s, whatever is asked for or left on screen', () => {
    for (const asked of ['voice', 'guitar', 'banjo', '', null]) {
      for (const active of ['guitar', 'voice'] as const) expect(checkInstrument(asked, active, false)).toBe('guitar')
    }
  })

  it('a link that says nothing gets the instrument on screen', () => {
    expect(checkInstrument(null, 'guitar', true)).toBe('guitar')
    expect(checkInstrument(null, 'voice', true)).toBe('voice')
    expect(checkInstrument('', 'voice', true)).toBe('voice')
    expect(checkInstrument('banjo', 'voice', true)).toBe('voice')
  })

  it('a link that asks for the guitar gets it whatever is on screen', () => {
    expect(checkInstrument('guitar', 'voice', true)).toBe('guitar')
  })

  it('singing has the weekly check and no other; the guitar has all three', () => {
    expect((['placement', 'checkpoint', 'monthly'] as const).filter((type) => checkOffered(type, 'voice'))).toEqual(['checkpoint'])
    expect((['placement', 'checkpoint', 'monthly'] as const).filter((type) => checkOffered(type, 'guitar'))).toEqual(['placement', 'checkpoint', 'monthly'])
  })
})

describe('the skill a weekly check looks at first', () => {
  const st = (skillId: string, rating: number) => ({ skillId, rating }) as SkillState
  const model = (...states: SkillState[]) => ({ skills: Object.fromEntries(states.map((s) => [s.skillId, s])) }) as Pick<LearnerModel, 'skills'>
  const both = model(st(SKILLS[0].id, 5), st(SKILLS[1].id, 50), st('voice.pitch.match', 70), st('voice.pitch.hold', 30), st('voice.pitch.steps', 45))

  it('is the pinned skill when it is one of the instrument\'s', () => {
    expect(focusSkillFor(both, { pinnedSkillId: 'voice.pitch.steps' }, VOICE_SKILLS)).toBe('voice.pitch.steps')
    expect(focusSkillFor(both, { pinnedSkillId: SKILLS[1].id }, SKILLS)).toBe(SKILLS[1].id)
  })

  it('is otherwise the weakest skill of that instrument, whatever else the model holds', () => {
    // The guitar skill rated 5 is the weakest on the device, and no business of a sung check.
    expect(focusSkillFor(both, {}, VOICE_SKILLS)).toBe('voice.pitch.hold')
    expect(focusSkillFor(both, {}, SKILLS)).toBe(SKILLS[0].id)
  })

  it('a pin that is not a skill of the instrument is passed over', () => {
    expect(focusSkillFor(both, { pinnedSkillId: SKILLS[1].id }, VOICE_SKILLS)).toBe('voice.pitch.hold')
    expect(focusSkillFor(both, { pinnedSkillId: 'retired.skill' }, SKILLS)).toBe(SKILLS[0].id)
  })

  it('a state for a skill the list no longer has is never chosen: the check would have no first task', () => {
    expect(focusSkillFor(model(st('retired.skill', 1), st(SKILLS[3].id, 40)), {}, SKILLS)).toBe(SKILLS[3].id)
  })

  it('with nothing practised yet it is the first skill of the instrument', () => {
    expect(focusSkillFor(model(), {}, VOICE_SKILLS)).toBe(VOICE_SKILLS[0].id)
    expect(focusSkillFor(model(st(SKILLS[0].id, 5)), {}, VOICE_SKILLS)).toBe(VOICE_SKILLS[0].id)
    expect(focusSkillFor(model(), {}, SKILLS)).toBe(SKILLS[0].id)
  })
})

describe('the range a sung task is built in', () => {
  it('is the stored one', () => {
    expect(singingRange({ range: { low: 57, high: 69, easy: 62, source: 'measured', at: 1 } })).toEqual({ low: 57, high: 69, easy: 62 })
  })

  it('is the lower starting range when none is stored, for exercises and songs alike', () => {
    expect(singingRange({})).toEqual(DEFAULT_RANGES.lower)
  })
})

describe('a song task of a sung check, while its song is made ready', () => {
  const fits = { fits: true }
  const tooWide = { fits: false }

  it('waits while the song is being arranged and its sound made', () => {
    expect(sungSongStep({ status: 'preparing' }, null)).toBe('waiting')
  })

  it('is sung once the run is there and the song fits the singer\'s range', () => {
    expect(sungSongStep({ status: 'ready', run: fits }, null)).toBe('sing')
  })

  it('is left out, not counted as a miss, when the song cannot be made ready, is no song to sing, or does not fit the range', () => {
    expect(sungSongStep({ status: 'failed' }, null)).toBe('left-out')
    expect(sungSongStep({ status: 'none' }, null)).toBe('left-out')
    expect(sungSongStep({ status: 'ready', run: tooWide }, null)).toBe('left-out')
  })

  it('the run the task opened with is the one that is sung, whatever happens to the range or the key meanwhile', () => {
    // A new range makes the live state go back to "preparing", then to another run, or to none at all.
    expect(sungSongStep({ status: 'preparing' }, fits)).toBe('sing')
    expect(sungSongStep({ status: 'failed' }, fits)).toBe('sing')
    expect(sungSongStep({ status: 'none' }, fits)).toBe('sing')
    expect(sungSongStep({ status: 'ready', run: tooWide }, fits)).toBe('sing')
  })

  it('a task that opened with a song too wide for the range stays left out', () => {
    expect(sungSongStep({ status: 'ready', run: fits }, tooWide)).toBe('left-out')
    expect(sungSongStep({ status: 'preparing' }, tooWide)).toBe('left-out')
  })
})

describe('a sung task: what is said before it', () => {
  const card = (task: TestTask) => textOf(renderToStaticMarkup(createElement(TaskCard, { task, position: 1, total: 3, onPlay: noop, instrument: 'voice' })))

  it('a step exercise names its step and no tempo', () => {
    expect(taskPace(SUNG_STEP, 'voice')).toEqual({ label: 'This step', value: '6 beats' })
    const text = card(SUNG_STEP)
    expect(text).toContain('6 beats')
    expect(text.join(' ')).not.toMatch(/bpm|tempo/i)
  })

  it('a step the ladder does not have reads as the nearest one it has', () => {
    const last = HOLD.steps?.at(-1)?.label
    expect(taskPace({ ...SUNG_STEP, params: { ...SUNG_STEP.params, step: 99 } }, 'voice').value).toBe(last)
    expect(taskPace({ ...SUNG_STEP, params: { tempo: 60, bars: 8 } }, 'voice').value).toBe(HOLD.steps?.[0].label)
  })

  it('an exercise that speeds up says how fast', () => {
    expect(taskPace(SUNG_TEMPO, 'voice')).toEqual({ label: 'Speed', value: '66 bpm' })
  })

  it('a song names its level by name: a song to sing has one speed', () => {
    expect(taskPace(SUNG_SONG, 'voice')).toEqual({ label: 'Level', value: VOICE_LEVELS[2].name })
    expect(card(SUNG_SONG).join(' ')).not.toMatch(/bpm|full speed/i)
  })

  it('a task that says nothing usable about its level or its skill still gets a tile, never an error', () => {
    for (const level of [Number.NaN, -4, 99, undefined, '2']) {
      const pace = taskPace({ ...SUNG_SONG, params: { ...SUNG_SONG.params, level } }, 'voice')
      expect(pace.label).toBe('Level')
      expect(VOICE_LEVELS.map((l) => l.name)).toContain(pace.value)
    }
    expect(taskPace({ ...SUNG_SONG, params: { ...SUNG_SONG.params, level: 99 } }, 'voice').value).toBe(VOICE_LEVELS.at(-1)?.name)
    // A skill nobody knows, or none at all: there is no ladder to name a step of.
    expect(taskPace({ ...SUNG_STEP, skillIds: ['voice.retired'] }, 'voice')).toEqual({ label: 'Speed', value: '60 bpm' })
    expect(taskPace({ ...SUNG_STEP, skillIds: [] }, 'voice')).toEqual({ label: 'Speed', value: '60 bpm' })
    // A guitar skill has no steps, whoever asks.
    expect(taskPace(GUITAR_TASK, 'voice')).toEqual({ label: 'Speed', value: '60 bpm' })
  })

  it('the guitar card keeps its tempo for every kind of task', () => {
    expect(taskPace(GUITAR_TASK)).toEqual({ label: 'Target tempo', value: '60 bpm' })
    expect(taskPace(GUITAR_SONG, 'guitar')).toEqual({ label: 'Target tempo', value: '100 bpm' })
  })

  it('names the singing skill it checks', () => {
    expect(card(SUNG_STEP)).toContain(HOLD.name)
    expect(card(SUNG_STEP)).not.toContain(HOLD.id)
  })

  it('states the pass mark in notes, not in percent or timing', () => {
    const rule = passRuleText(VOICE_TEST_PASS, 'voice')
    expect(rule).toMatch(/about 8 notes in every 10/)
    expect(rule).not.toMatch(/%|timing|early|late/i)
    expect(card(SUNG_STEP).join(' ')).toContain(rule)
  })

  it('nothing on the cards before a sung check is in the guitar\'s words', () => {
    const intro = textOf(renderToStaticMarkup(createElement(TaskIntro, { type: 'checkpoint', taskCount: 3, onStart: noop, onCancel: noop, instrument: 'voice' })))
    for (const line of [...intro, ...card(SUNG_STEP), ...card(SUNG_TEMPO), ...card(SUNG_SONG)]) {
      expect(line).not.toMatch(NOT_FOR_A_SINGER)
      expect(line).not.toMatch(NO_USE_TO_A_BEGINNER)
    }
    expect(intro[0]).toBe(checkWords('voice').title('checkpoint'))
    // Voice care: the page that opens a check says a tired voice may stop.
    expect(intro.join(' ')).toMatch(/tired/)
  })
})

describe('a sung task: what is said after it', () => {
  const sung = (partial: Partial<AttemptResult> = {}) => result({ perfects: 8, goods: 0, misses: 0, total: 8, timingMedianMs: 180, timingStdevMs: null, ...partial })
  const drawn = (r: AttemptResult, passed: boolean, tip: string | null = null) =>
    textOf(renderToStaticMarkup(createElement(TaskResultCard, { task: SUNG_STEP, passed, result: r, last: false, onNext: noop, instrument: 'voice', tip })))

  it('when a note begins never decides a sung task', () => {
    // 180 ms behind the click, or half a second: a singer comes in when the note is found.
    for (const timingMedianMs of [-400, -30, 0, 31, 180, 500, 2000]) {
      const r = sung({ timingMedianMs })
      expect(meetsCriteria(VOICE_TEST_PASS, r)).toBe(true)
      expect(failedCriteria(VOICE_TEST_PASS, r)).toEqual([])
      expect(failureReasons(VOICE_TEST_PASS, r, 'voice')).toEqual([])
    }
  })

  it('no sentence about a sung result speaks of milliseconds or of the beat, whatever the result', () => {
    const timings = [null, -400, 0, 42, 500, 20000]
    const spreads = [null, 75, 20000]
    for (let perfects = 0; perfects <= 16; perfects += 4) {
      for (let goods = 0; perfects + goods <= 16; goods += 4) {
        for (const timingMedianMs of timings) {
          for (const timingStdevMs of spreads) {
            const r = result({ perfects, goods, misses: 16 - perfects - goods, timingMedianMs, timingStdevMs })
            const lines = [...failureReasons(VOICE_TEST_PASS, r, 'voice'), verdictBadge(failedCriteria(VOICE_TEST_PASS, r), 'voice')]
            for (const line of lines) {
              expect(line).not.toMatch(/\bms\b|\bbeat\b|early|\blate\b|timing|spread/i)
              expect(line).not.toMatch(NOT_FOR_A_SINGER)
            }
            // Every missed part of the rule still gets its sentence.
            expect(failureReasons(VOICE_TEST_PASS, r, 'voice')).toHaveLength(failedCriteria(VOICE_TEST_PASS, r).length)
          }
        }
      }
    }
  })

  it('a task that was not passed says how many notes it takes', () => {
    const r = sung({ perfects: 5, goods: 0, misses: 3 })
    expect(meetsCriteria(VOICE_TEST_PASS, r)).toBe(false)
    expect(failureReasons(VOICE_TEST_PASS, r, 'voice')).toEqual(['About 7 of 8 notes are needed here.'])
  })

  it('a short task that takes every note says so, not "about 4 of 4"', () => {
    // Four notes: three clean ones are 75 %, under the mark, so all four are needed.
    const r = sung({ perfects: 3, goods: 0, misses: 1, total: 4 })
    expect(meetsCriteria(VOICE_TEST_PASS, r)).toBe(false)
    expect(meetsCriteria(VOICE_TEST_PASS, sung({ perfects: 4, total: 4 }))).toBe(true)
    expect(failureReasons(VOICE_TEST_PASS, r, 'voice')).toEqual(['All 4 notes are needed here.'])
  })

  it('and says that a note only just in tune counts a little less, when that is what made the difference', () => {
    // Seven of eight reached, six of them only just: 0.8 x 6 + 1 = 5.8 of 8, under the mark.
    const r = sung({ perfects: 1, goods: 6, misses: 1 })
    expect(meetsCriteria(VOICE_TEST_PASS, r)).toBe(false)
    const [reason] = failureReasons(VOICE_TEST_PASS, r, 'voice')
    expect(reason).toMatch(/^6 of your notes were only just in tune/)
    expect(reason).toMatch(/About 7 of 8 notes are needed here\.$/)
    expect(failureReasons(VOICE_TEST_PASS, sung({ perfects: 4, goods: 1, misses: 3 }), 'voice')[0]).toMatch(/^1 of your notes was only just in tune/)
  })

  it('the number of notes it names is the number the pass mark takes, for a task of any length', () => {
    // Read back from the sentence and tried against the rule itself: that many clean notes pass, one fewer does not.
    for (let total = 2; total <= 40; total++) {
      const none = sung({ perfects: 0, goods: 0, misses: total, total })
      const [reason] = failureReasons(VOICE_TEST_PASS, none, 'voice')
      const said = /^All (\d+) notes are needed here\.$/.exec(reason) ?? /^About (\d+) of (\d+) notes are needed here\.$/.exec(reason)
      expect(said, `${total} notes: "${reason}"`).not.toBeNull()
      const needed = Number(said?.[1])
      expect(Number(said?.[2] ?? needed)).toBe(total)
      expect(needed).toBeLessThanOrEqual(total)
      expect(meetsCriteria(VOICE_TEST_PASS, sung({ perfects: needed, misses: total - needed, total }))).toBe(true)
      expect(meetsCriteria(VOICE_TEST_PASS, sung({ perfects: needed - 1, misses: total - needed + 1, total }))).toBe(false)
      // "All" is said exactly when no note can be spared.
      expect(reason.startsWith('All ')).toBe(needed === total)
    }
  })

  it('a task of one note does not say "all 1 notes"', () => {
    const r = sung({ perfects: 0, goods: 0, misses: 1, total: 1 })
    expect(meetsCriteria(VOICE_TEST_PASS, r)).toBe(false)
    expect(failureReasons(VOICE_TEST_PASS, r, 'voice')).toEqual(['This one note is needed here.'])
    expect(drawn(r, false)).toContain('You were on the note for 0 of 1 note.')
  })

  it('the count of notes on the card is the notes that counted, whatever the split between clean and only just', () => {
    expect(drawn(sung({ perfects: 2, goods: 3, misses: 3 }), false)).toContain('You were on the note for 5 of 8 notes.')
    expect(drawn(sung({ perfects: 0, goods: 0, misses: 8 }), false)).toContain('You were on the note for 0 of 8 notes.')
  })

  it('the card counts notes, gives the tip, and has no tile for percent, timing or spread', () => {
    const text = drawn(sung({ perfects: 5, goods: 0, misses: 3 }), false, 'A little under the note. Think a bit higher and try again.')
    expect(text).toEqual([
      'Task result',
      `Focus: ${HOLD.name}`,
      'Not yet',
      verdictBadge(['accuracy'], 'voice'),
      'You were on the note for 5 of 8 notes.',
      'A little under the note. Think a bit higher and try again.',
      'About 7 of 8 notes are needed here.',
      'Next',
    ])
  })

  it('a passed sung task shows the count and nothing about time', () => {
    const text = drawn(sung(), true)
    expect(text).toEqual(['Task result', `Focus: ${HOLD.name}`, 'Passed', 'on target', 'You were on the note for 8 of 8 notes.', 'Next'])
    expect(text.join(' ')).not.toMatch(/\bms\b|%|Timing|Spread|Accuracy/)
  })
})

describe('the report of a sung check', () => {
  const sung = { ...record('checkpoint', { 'voice.pitch.match': 3.24, 'voice.pitch.hold': -1.5, 'voice.pitch.steps': 0 }, ['voice.pitch.hold', 'voice.range.slides']), instrument: 'voice' as const }
  // Drawn inside each case, so a missing word fails that case and not the whole file.
  const draw = () => textOf(renderToStaticMarkup(createElement(TestReportView, { record: sung, notes: [checkWords('voice').skipped('Stretch: Z')], onHome: noop, onProgress: noop })))

  it('names the singing skills', () => {
    const text = draw()
    expect(text).toContain('Match a note')
    expect(text).toContain('Hold a note steady')
    expect(text).toContain('Slides')
    expect(text.join(' ')).not.toMatch(/voice\.(pitch|range)/)
  })

  it('says which way a skill moved, without a number a beginner cannot use', () => {
    const text = draw()
    expect(text.join(' ')).not.toMatch(/3\.2|1\.5|\d+ →/)
    expect(text).not.toContain('Rating changes')
    expect(text.slice(text.indexOf('Match a note'), text.indexOf('Match a note') + 2)).toEqual(['Match a note', checkWords('voice').moved(true)])
    expect(text.slice(text.indexOf('Hold a note steady'), text.indexOf('Hold a note steady') + 2)).toEqual(['Hold a note steady', checkWords('voice').moved(false)])
    // A skill that did not move is not listed, as on the guitar report.
    expect(text).not.toContain('Step up and down')
  })

  it('a move too small to show as a number on the guitar report is still named by its direction', () => {
    const tiny = { ...record('checkpoint', { 'voice.pitch.match': 0.04, 'voice.pitch.hold': -0.04 }, []), instrument: 'voice' as const }
    const text = textOf(renderToStaticMarkup(createElement(TestReportView, { record: tiny, onHome: noop, onProgress: noop })))
    expect(text.slice(text.indexOf('Match a note'), text.indexOf('Match a note') + 2)).toEqual(['Match a note', checkWords('voice').moved(true)])
    expect(text.slice(text.indexOf('Hold a note steady'), text.indexOf('Hold a note steady') + 2)).toEqual(['Hold a note steady', checkWords('voice').moved(false)])
    // No "0", "+0" or "-0" where the guitar report would print the rounded number.
    expect(text.join(' ')).not.toMatch(/(^|[\s+-])0(\.\d+)?(\s|$)/)
  })

  it('a guitar check on a device that also sings keeps its numbers: the stamp decides, not the skills named', () => {
    const guitar = record('checkpoint', { [SKILLS[0].id]: 3.24 }, ['voice.pitch.hold'])
    const text = textOf(renderToStaticMarkup(createElement(TestReportView, { record: guitar, onHome: noop, onProgress: noop })))
    expect(text[0]).toBe('Weekly checkpoint')
    expect(text).toContain('+3.2')
    expect(text).toContain('Rating changes')
  })

  it('reads the instrument from the record when it is not told', () => {
    expect(textOf(renderToStaticMarkup(createElement(TestReportView, { record: sung, onHome: noop, onProgress: noop })))[0]).toBe(checkWords('voice').title('checkpoint'))
  })

  it('is in a singer\'s words from top to bottom', () => {
    for (const line of draw()) {
      expect(line).not.toMatch(NOT_FOR_A_SINGER)
      expect(line).not.toMatch(NO_USE_TO_A_BEGINNER)
    }
  })
})

describe('every word of a sung check', () => {
  it('is free of the guitar\'s words and of the words the singing side never uses', () => {
    const words = checkWords('voice')
    const said: string[] = [
      words.title('checkpoint'),
      words.blurb('checkpoint'),
      words.count('checkpoint', 1),
      words.count('checkpoint', 3),
      words.mic,
      words.rulesHeading,
      ...words.rules,
      words.kind(true),
      words.kind(false),
      words.measures,
      words.songMeasure,
      words.beforeRule,
      words.start,
      words.leave,
      words.preparing,
      words.nothing.title,
      words.nothing.subtitle,
      words.noTasks,
      words.gettingSongReady,
      ...Object.values(words.trouble),
      words.skipped('Stretch: Z'),
      words.changes(false),
      words.moved(true),
      words.moved(false),
      words.nextFocus,
      passRuleText(VOICE_TEST_PASS, 'voice'),
    ]
    for (const line of said) {
      expect(line).not.toMatch(NOT_FOR_A_SINGER)
      expect(line).not.toMatch(NO_USE_TO_A_BEGINNER)
      expect(line).not.toMatch(/\btest\b/i)
    }
  })
})
