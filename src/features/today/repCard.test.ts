import { describe, expect, it } from 'vitest'
import { REP_DOWN_ACCURACY, REP_UP_ACCURACY } from '../../training/constants'
import { skillById } from '../../training/instruments'
import { nextRepStep, nextRepTempo } from '../../training/planner'
import type { SkillDef } from '../../training/types'
import { VOICE_SKILLS } from '../../training/voiceSkills'
import type { ScoreSummary } from '../play/scoring'
import { VOICE_TIPS } from '../play/voice/voiceCopy'
import type { NoteReason, VoiceScoreSummary } from '../play/voice/voiceTracker'
import {
  FRETTING_TIP,
  LISTEN_FIRST,
  blockResultLine,
  blockTip,
  hasPace,
  nextRoundText,
  nextSungRoundText,
  resultCaption,
  roundBadge,
  roundWord,
  scoreHint,
  stepThatFits,
  sungCardCopy,
  sungSongView,
  sungStepLine,
} from './repCard'

describe('nextRoundText: the rep card says what the next round will really be', () => {
  it('says slower when the round went badly and the tempo drops', () => {
    // 3 of 8 notes: the next round is slowed down.
    const next = nextRepTempo(60, 3 / 8, 60)
    expect(next).toBeLessThan(60)
    expect(nextRoundText(60, next)).toMatch(/slower/)
    expect(nextRoundText(60, next)).not.toMatch(/faster/)
  })

  it('says the same pace when the tempo stays', () => {
    const accuracy = (REP_DOWN_ACCURACY + REP_UP_ACCURACY) / 2
    const next = nextRepTempo(60, accuracy, 60)
    expect(next).toBe(60)
    expect(nextRoundText(60, next)).toBe('Next round at the same pace')
  })

  it('says faster only when the tempo goes up', () => {
    const next = nextRepTempo(60, 1, 60)
    expect(next).toBeGreaterThan(60)
    expect(nextRoundText(60, next)).toBe('Next round a bit faster')
  })

  it('compares the tempos as they are shown, in whole beats per minute', () => {
    expect(nextRoundText(60.2, 59.8)).toBe('Next round at the same pace')
    // Already at the cap for the day: a perfect round stays where it is.
    expect(nextRoundText(69, nextRepTempo(69, 1, 60))).toBe('Next round at the same pace')
  })
})

describe('hasPace / blockResultLine: ear rounds have no timing and no tempo', () => {
  it('treats ear training as unpaced and everything else as paced', () => {
    expect(hasPace({ interaction: 'ear' })).toBe(false)
    expect(hasPace({ interaction: undefined })).toBe(true)
  })

  it('leaves the tempo out of the result of an ear block', () => {
    expect(blockResultLine(75, 60, false)).toBe('75% accuracy')
    expect(blockResultLine(75, 63.6, true)).toBe('75% accuracy · reached 64 bpm')
  })
})

describe('scoreHint: a clean block that leaves the score where it was says why', () => {
  const base = { before: 85, after: 85, accuracy: 0.95, tempo: 60, targetTempo: 100, paced: true }
  it('explains that the score follows the tempo', () => {
    expect(scoreHint(base)).toMatch(/goes up again as the rounds get faster/)
  })
  it('says nothing when the score moved, when the playing was not clean, or for ear training', () => {
    expect(scoreHint({ ...base, after: 86 })).toBe('')
    expect(scoreHint({ ...base, accuracy: 0.8 })).toBe('')
    expect(scoreHint({ ...base, paced: false })).toBe('')
    // A fraction of a point shows as no change: it is explained too.
    expect(scoreHint({ ...base, after: 85.2 })).not.toBe('')
  })
  it('at the top there is nothing left to gain, and it says so', () => {
    expect(scoreHint({ ...base, before: 100, after: 100, tempo: 100 })).toMatch(/tempo it aims for/)
    expect(scoreHint({ ...base, before: 92, after: 92, tempo: 100 })).toBe('')
  })
})

// ---------------------------------------------------------------------------------------------------
// Sung rounds. Everything above is the guitar as it was before singing; none of it was edited.
// ---------------------------------------------------------------------------------------------------

const voiceSkill = (id: string): SkillDef => {
  const skill = skillById(id)
  if (!skill) throw new Error(`no skill ${id}`)
  return skill
}
/** Accuracies as the Coach sorts them: clean, neither clean nor rough, rough. */
const CLEAN = 1
const BETWEEN = (REP_DOWN_ACCURACY + REP_UP_ACCURACY) / 2
const ROUGH = 0.4
/** Words a singer is never shown: the guitar's, the unkind ones, and numbers a beginner cannot use. */
const NOT_FOR_A_SINGER = /\b(play\w*|guitars?|strings?|frets?|strum\w*|pick\w*|wrong|fail\w*|tone.?deaf|loud\w*|push\w*|belt\w*|cents?|ratings?|tiers?|reps?)\b/i

describe('nextSungRoundText: a step exercise says which step comes next, never a pace', () => {
  const hold = voiceSkill('voice.pitch.hold')
  const top = hold.steps!.length - 1
  /** The card after a round on `step`, with the step the Coach really picks for the next one. */
  const after = (step: number, accuracy: number, startStep = step, heldBefore = false) => {
    const next = nextRepStep(step, accuracy, startStep, top, heldBefore)
    return { next, text: nextSungRoundText({ step: { now: step, next, nextLabel: hold.steps![next].label }, tempo: hold.startTempo, nextTempo: hold.startTempo, accuracy }) }
  }

  it('names the next step after a clean round', () => {
    const card = after(0, CLEAN)
    expect(card.next).toBe(1)
    expect(card.text).toBe('Next round: 6 beats')
  })

  it('says a step easier, and which, after a rough round', () => {
    const card = after(2, ROUGH)
    expect(card.next).toBe(1)
    expect(card.text).toBe('Next round a step easier: 6 beats')
    expect(card.text).not.toMatch(/slower/)
  })

  it('says a step easier after two rounds in a row that were neither clean nor rough', () => {
    const card = after(1, BETWEEN, 1, true)
    expect(card.next).toBe(0)
    expect(card.text).toBe('Next round a step easier: 4 beats')
  })

  it('says the same again while the step stays', () => {
    const card = after(1, BETWEEN)
    expect(card.next).toBe(1)
    expect(card.text).toBe('Next round the same again')
    // Clean, but already one step above where the block began: the step stays for today.
    const capped = after(1, CLEAN, 0)
    expect(capped.next).toBe(1)
    expect(capped.text).toBe('Next round the same again')
  })

  it('offers to listen first when a rough round has no easier step under it', () => {
    const card = after(0, ROUGH)
    expect(card.next).toBe(0)
    expect(card.text).toBe(LISTEN_FIRST)
    expect(LISTEN_FIRST).toBe('Listen first, then once more')
  })

  it('never speaks of a pace: the tempo of a step exercise is the same on every round', () => {
    for (const skill of VOICE_SKILLS.filter((s) => (s.steps?.length ?? 0) > 0)) {
      const last = skill.steps!.length - 1
      for (let step = 0; step <= last; step++) {
        for (const accuracy of [CLEAN, BETWEEN, ROUGH]) {
          for (const held of [false, true]) {
            const next = nextRepStep(step, accuracy, step, last, held)
            const text = nextSungRoundText({ step: { now: step, next, nextLabel: skill.steps![next].label }, tempo: skill.startTempo, nextTempo: skill.startTempo, accuracy })
            expect(text, `${skill.id} ${step}: ${text}`).not.toMatch(/\b(pace|faster|slower|bpm|tempo)\b/i)
            expect(text, `${skill.id} ${step}: ${text}`).not.toMatch(NOT_FOR_A_SINGER)
            if (next !== step) expect(text).toContain(skill.steps![next].label)
          }
        }
      }
    }
  })
})

describe('nextSungRoundText: a sung exercise that gets faster', () => {
  const steps = voiceSkill('voice.pitch.steps')
  const floor = steps.minTempo!
  const after = (tempo: number, accuracy: number, heldBefore = false) => {
    const nextTempo = nextRepTempo(tempo, accuracy, tempo, steps.targetTempo, heldBefore, floor)
    return { nextTempo, text: nextSungRoundText({ tempo, nextTempo, accuracy }) }
  }

  it('says faster after a clean round and slower after a rough one', () => {
    expect(after(66, CLEAN).text).toBe('Next round a bit faster')
    const rough = after(66, ROUGH)
    expect(rough.nextTempo).toBeLessThan(66)
    expect(rough.text).toBe('Next round a bit slower')
  })

  it('says the same pace when the pace stays after a round that was not rough', () => {
    expect(after(66, BETWEEN).text).toBe('Next round at the same pace')
    // Clean at the tempo the skill aims for: there is nothing faster.
    expect(after(steps.targetTempo, CLEAN).text).toBe('Next round at the same pace')
  })

  it('offers to listen first when a rough round is already as slow as the exercise goes', () => {
    // Slower would make each line outlast the breath, so the Coach repeats the round at the floor.
    const card = after(floor, ROUGH)
    expect(card.nextTempo).toBe(floor)
    expect(card.text).toBe(LISTEN_FIRST)
  })

  it('never tells a singer to play', () => {
    for (const accuracy of [CLEAN, BETWEEN, ROUGH]) for (const tempo of [floor, 66, steps.targetTempo]) expect(after(tempo, accuracy).text).not.toMatch(NOT_FOR_A_SINGER)
  })
})

describe('roundWord / roundBadge: what a round is called', () => {
  it('is a rep only to a guitarist who asked for the details', () => {
    expect(roundWord(false)).toBe('Rep')
    expect(roundWord(true)).toBe('Round')
    expect(roundWord(false, true)).toBe('Round')
    expect(roundWord(true, true)).toBe('Round')
  })

  it("keeps the guitarist's badge as it was", () => {
    expect(roundBadge({ simple: true, rep: 2, reps: 3, tempo: 63.6 })).toBe('Round 2 of 3')
    expect(roundBadge({ simple: false, rep: 2, reps: 3, tempo: 63.6 })).toBe('Rep 2/3 · 64 bpm')
  })

  it('shows a singer the step where a tempo would stand, and never "rep"', () => {
    expect(roundBadge({ simple: true, rep: 1, reps: 3, tempo: 60, sung: true, stepLabel: '6 beats' })).toBe('Round 1 of 3')
    expect(roundBadge({ simple: false, rep: 1, reps: 3, tempo: 60, sung: true, stepLabel: '6 beats' })).toBe('Round 1/3 · 6 beats')
    expect(roundBadge({ simple: false, rep: 1, reps: 3, tempo: 66, sung: true })).toBe('Round 1/3 · 66 bpm')
  })
})

describe('blockTip: one tip on the result of a block', () => {
  const tips = ['First tip of the skill.', 'Second tip.']

  it("gives a guitarist the fretting tip after a block that went badly, else the skill's first tip", () => {
    expect(blockTip({ accuracy: 0.49, skillTips: tips })).toBe(FRETTING_TIP)
    expect(FRETTING_TIP).toBe('Buzzing or muted notes? Press each string firmly just behind the metal bar (fret), close to it.')
    expect(blockTip({ accuracy: 0.5, skillTips: tips })).toBe('First tip of the skill.')
    expect(blockTip({ accuracy: 0.9, skillTips: [] })).toBe('')
  })

  it('never tells a singer about frets: what the run showed comes first, then the tip of the skill', () => {
    expect(blockTip({ accuracy: 0.2, skillTips: tips, sung: { runTip: null } })).toBe('First tip of the skill.')
    expect(blockTip({ accuracy: 0.2, skillTips: tips, sung: { runTip: 'A little under the note. Think a bit higher and try again.' } })).toBe('A little under the note. Think a bit higher and try again.')
    expect(blockTip({ accuracy: 0.2, skillTips: [], sung: { runTip: null } })).toBe('')
    for (const skill of VOICE_SKILLS) expect(blockTip({ accuracy: 0.1, skillTips: skill.tips, sung: { runTip: null } })).toBe(skill.tips[0])
  })
})

describe('the result of a block, for a learner who asked for the details', () => {
  it('says what a guitar block reached, as it always did', () => {
    expect(resultCaption({ paced: true, tempo: 63.6 })).toBe('accuracy · reached 64 bpm')
    expect(resultCaption({ paced: false, tempo: 60 })).toBe('accuracy')
    expect(resultCaption({ paced: true, tempo: 63.6, stepLabel: null })).toBe('accuracy · reached 64 bpm')
  })

  it('names the step last sung where the tempo would stand: a step exercise has one tempo for good', () => {
    expect(resultCaption({ paced: true, tempo: 60, stepLabel: '6 beats' })).toBe('accuracy · last round: 6 beats')
    expect(resultCaption({ paced: true, tempo: 60, stepLabel: '6 beats' })).not.toMatch(/bpm/)
  })
})

describe('the result of a sung block, in plain words', () => {

  it('has a plain line for the step, without a number a beginner cannot use', () => {
    expect(sungStepLine('6 beats')).toBe('Last round: 6 beats')
    expect(sungStepLine('6 beats')).not.toMatch(/accuracy|bpm|%/)
  })
})

describe('scoreHint for a sung block', () => {
  const base = { before: 62, after: 62, accuracy: 0.95, tempo: 60, targetTempo: 60, paced: true, sung: true }

  it('says the score follows the steps of a step exercise, not a tempo', () => {
    const hint = scoreHint({ ...base, step: { now: 1, top: 3 } })
    expect(hint).toBe('Clean. This score goes up again on the next step.')
    expect(hint).not.toMatch(/faster|tempo/)
  })

  it('says nothing on the last step: there is no next one to point to', () => {
    expect(scoreHint({ ...base, before: 92, after: 92, step: { now: 3, top: 3 } })).toBe('')
  })

  it('says nothing when the score moved or the round was not clean', () => {
    expect(scoreHint({ ...base, after: 63, step: { now: 1, top: 3 } })).toBe('')
    expect(scoreHint({ ...base, accuracy: 0.8, step: { now: 1, top: 3 } })).toBe('')
  })

  it('at the top says so in a singer\'s words', () => {
    const hint = scoreHint({ ...base, before: 100, after: 100, step: { now: 3, top: 3 } })
    expect(hint).toMatch(/It comes back now and then/)
    expect(hint).not.toMatch(NOT_FOR_A_SINGER)
    expect(hint).not.toMatch(/tempo/)
  })

  it('keeps the tempo line for a sung exercise that gets faster', () => {
    expect(scoreHint({ ...base, tempo: 66, targetTempo: 88 })).toMatch(/goes up again as the rounds get faster/)
  })
})

describe('nextSungRoundText: where "rough" begins', () => {
  const hold = voiceSkill('voice.pitch.hold')
  const steps = voiceSkill('voice.pitch.steps')

  it('offers to listen first only under the mark the Coach calls rough, not on it', () => {
    // Exactly on the mark the Coach keeps the step and does not call the round rough: neither does the card.
    const on = { now: 0, next: nextRepStep(0, REP_DOWN_ACCURACY, 0, 3), nextLabel: hold.steps![0].label }
    expect(on.next).toBe(0)
    expect(nextSungRoundText({ step: on, tempo: 60, nextTempo: 60, accuracy: REP_DOWN_ACCURACY })).toBe('Next round the same again')
    expect(nextSungRoundText({ step: on, tempo: 60, nextTempo: 60, accuracy: REP_DOWN_ACCURACY - 0.001 })).toBe(LISTEN_FIRST)
    const floor = steps.minTempo!
    expect(nextRepTempo(floor, REP_DOWN_ACCURACY, floor, steps.targetTempo, false, floor)).toBe(floor)
    expect(nextSungRoundText({ tempo: floor, nextTempo: floor, accuracy: REP_DOWN_ACCURACY })).toBe('Next round at the same pace')
    expect(nextSungRoundText({ tempo: floor, nextTempo: floor, accuracy: REP_DOWN_ACCURACY - 0.001 })).toBe(LISTEN_FIRST)
  })

  it('reads the pace as it is shown, in whole beats a minute', () => {
    // 54.4 and 54 are the same number on the screen: nothing got slower, so nothing is said to.
    expect(nextSungRoundText({ tempo: 54.4, nextTempo: 54, accuracy: 0.8 })).toBe('Next round at the same pace')
  })

  it('names the step the round lands on when it drops more than one (the easy notes got fewer on the way)', () => {
    expect(nextSungRoundText({ step: { now: 2, next: 0, nextLabel: hold.steps![0].label }, tempo: 60, nextTempo: 60, accuracy: 0.9 })).toBe('Next round a step easier: 4 beats')
  })
})

describe('stepThatFits: the step the next round is really built on', () => {
  const slides = voiceSkill('voice.range.slides')
  const top = slides.steps!.length - 1
  /** Easy notes that span `room` semitones from C3. */
  const span = (room: number) => ({ low: 48, high: 48 + room })

  it('is the step the Coach picked while the easy notes hold it', () => {
    expect(stepThatFits(slides, top, span(12))).toBe(top)
    expect(stepThatFits(slides, 1, span(7))).toBe(1)
    expect(stepThatFits(slides, 0, span(7))).toBe(0)
  })

  it('comes down to the highest step that fits after "Tight" took the note that step needed', () => {
    // The widest slide needs an octave. One note fewer, and the round is built on the step below.
    expect(slides.steps![top].span).toBe(12)
    expect(stepThatFits(slides, top, span(11))).toBe(top - 1)
  })

  it('never moves a step up, and leaves a skill without steps alone', () => {
    expect(stepThatFits(slides, 0, span(14))).toBe(0)
    expect(stepThatFits(voiceSkill('voice.pitch.steps'), 0, span(7))).toBe(0)
  })

  it('agrees with what is built for every step skill in the smallest easy notes', () => {
    for (const skill of VOICE_SKILLS.filter((s) => (s.steps?.length ?? 0) > 0)) {
      const last = skill.steps!.length - 1
      const fits = stepThatFits(skill, last, span(7))
      // Every step up to it fits, and the one above it (if any) does not.
      for (let step = 0; step <= fits; step++) expect(skill.steps![step].span ?? 0, `${skill.id} ${step}`).toBeLessThanOrEqual(7)
      if (fits < last) expect(skill.steps![fits + 1].span ?? 0, skill.id).toBeGreaterThan(7)
    }
  })
})

describe('sungCardCopy: the line and the tip of a sung run, for the card it stands on', () => {
  const sungRun = (reasons: Partial<Record<NoteReason, number>>, hits = 5, notes = 8): VoiceScoreSummary => ({
    score: hits * 80,
    streak: 0,
    maxStreak: hits,
    multiplier: 1,
    perfects: 0,
    goods: hits,
    misses: notes - hits,
    total: notes,
    judged: notes,
    accuracy: hits / notes,
    voice: { notes, hits, octave: 0, medianCents: -40, reasons: { silent: 0, low: 0, high: 0, unsteady: 0, slid: 0, ...reasons } },
  })

  it('asks for another go on a card that has one after it', () => {
    expect(sungCardCopy(sungRun({ low: 3 }), undefined, false)).toEqual({ line: 'You were on the note for 5 of 8 notes.', tip: VOICE_TIPS.low })
    expect(VOICE_TIPS.low).toMatch(/try again/)
  })

  it('does not ask for another go on the card that ends the block: there is none', () => {
    const over = sungCardCopy(sungRun({ low: 3 }), undefined, true)
    expect(over.line).toBe('You were on the note for 5 of 8 notes.')
    expect(over.tip).toBe('A little under the note. Think a bit higher.')
    // Whatever the run showed, the advice stays and the asking goes.
    for (const reason of ['silent', 'low', 'high', 'unsteady'] as const) {
      const tip = sungCardCopy(sungRun({ [reason]: 3 }), undefined, true).tip
      expect(tip, reason).not.toBeNull()
      expect(tip, reason).not.toMatch(/try again|once more/i)
      expect(tip, reason).toMatch(/\.$/)
    }
  })

  it('keeps what the chart says about itself: sliding up is not a habit on a chart of slides', () => {
    const slid = sungRun({ slid: 6 }, 8, 8)
    expect(sungCardCopy(slid, undefined, false).tip).toBe(VOICE_TIPS.slid)
    expect(sungCardCopy(slid, { glide: true }, false).tip).toBeNull()
    expect(sungCardCopy(slid, { glide: true }, true).tip).toBeNull()
  })

  it('has a line and no tip for a run whose reasons were not kept, and nothing at all before a run', () => {
    const { voice: _dropped, ...bare } = sungRun({ low: 3 })
    expect(sungCardCopy(bare as ScoreSummary, undefined, false)).toEqual({ line: 'You were on the note for 5 of 8 notes.', tip: null })
    expect(sungCardCopy(null, undefined, false)).toEqual({ line: '', tip: null })
  })
})

describe('sungSongView: what a song block of a singing plan puts on the screen', () => {
  const ready = (key: string, fits = true) => ({ status: 'ready' as const, run: { key, fits } })

  it('waits while the tracks are being made, and says so when they could not be', () => {
    expect(sungSongView({ status: 'preparing' }, null)).toBe('getting-ready')
    expect(sungSongView({ status: 'failed' }, null)).toBe('not-ready')
    expect(sungSongView({ status: 'none' }, null)).toBe('not-ready')
  })

  it('shows the player once both tracks exist and the song fits the easy notes', () => {
    expect(sungSongView(ready('sing-mary-lamb:1:-5:0:3'), null)).toBe('player')
    expect(sungSongView(ready('sing-mary-lamb:1:-5:0:3', false), null)).toBe('later')
  })

  it('never puts the arrangement back on screen that was sung before the Coach moved the key', () => {
    // The key choice is stored before the Coach answers, and the new arrangement reaches the screen a
    // moment later. Until then the old one still looks like the latest: sung again, it would be
    // counted as a run in the new key.
    expect(sungSongView(ready('sing-mary-lamb:1:-5:0:3'), 'sing-mary-lamb:1:-5:0:3')).toBe('getting-ready')
    expect(sungSongView({ status: 'preparing' }, 'sing-mary-lamb:1:-5:0:3')).toBe('getting-ready')
    // The new arrangement has another name (its key is in it) and is shown as soon as it is there.
    expect(sungSongView(ready('sing-mary-lamb:1:-6:0:3'), 'sing-mary-lamb:1:-5:0:3')).toBe('player')
  })

  it('still says so when the new arrangement could not be made, or does not fit', () => {
    expect(sungSongView({ status: 'failed' }, 'sing-mary-lamb:1:-5:0:3')).toBe('not-ready')
    expect(sungSongView(ready('sing-mary-lamb:1:-6:0:3', false), 'sing-mary-lamb:1:-5:0:3')).toBe('later')
  })
})
