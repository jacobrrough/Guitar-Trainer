import { describe, expect, it } from 'vitest'
import { unlockMilestones } from './milestones'
import { planSession } from './planner'
import { SKILLS, SKILLS_BY_ID } from './skills'
import type { LearnerModel, SkillState } from './types'
import { COURSE } from '../lessons/course'
import type { Lesson } from '../lessons/types'
import { missingPrerequisites, openContextOf, skillOpener, taughtSkillIds } from './unlock'

const NOW = new Date(2026, 5, 15, 10, 0, 0).getTime()
const DAY = 86_400_000

function model(ratings: Record<string, number>, extra: Record<string, Partial<SkillState>> = {}): LearnerModel {
  const skills = Object.fromEntries(
    Object.entries(ratings).map(([skillId, rating]): [string, SkillState] => [
      skillId,
      { skillId, rating, confidence: 5, tempoCeiling: 0, ease: 2.3, intervalDays: 1, plateauStep: 0, attempts: 0, ...extra[skillId] },
    ]),
  )
  return { skills, songItems: {}, profile: { id: 1, goals: [], dailyMinutes: 20, startedAt: 0, streak: 0, longestStreak: 0, sessionsSinceTest: 0 } }
}

const open = (m: LearnerModel, id: string, taught?: string[]) => skillOpener(SKILLS, openContextOf(m, NOW, taught))(SKILLS_BY_ID[id])

describe('one rule for "is this skill open"', () => {
  // Strong chord changes over shaky open chords: the audit's case.
  const shaky = model({ 'fret.single-string': 70, 'fret.cross-string': 65, 'chord.open': 29, 'chord.changes-open': 75 })
  const solid = model({ 'fret.single-string': 70, 'fret.cross-string': 65, 'chord.open': 62, 'chord.changes-open': 75 })

  it('looks at the whole chain: barre chords stay closed while open chords are shaky', () => {
    expect(open(shaky, 'chord.barre')).toBe(false)
    expect(open(solid, 'chord.barre')).toBe(true)
  })

  it('does not announce "Barre chords unlocked" while the planner keeps them closed', () => {
    const ratings = (m: LearnerModel) => openContextOf(m, NOW).ratings
    const before = { ...ratings(shaky), 'chord.changes-open': 55 }
    expect(unlockMilestones(SKILLS, before, ratings(shaky), NOW).map((x) => x.skillId)).not.toContain('chord.barre')
    const nearly = { ...ratings(solid), 'chord.open': 58 }
    expect(unlockMilestones(SKILLS, nearly, ratings(solid), NOW).map((x) => x.skillId)).toContain('chord.barre')
  })

  it('a skill the learner already practises is open, and is not announced as unlocked later', () => {
    const lesson = { attempts: 3, lastPracticedAt: NOW - DAY }
    const met = model({ 'fret.single-string': 30, 'fret.cross-string': 40, 'chord.open': 26 }, { 'chord.open': lesson })
    expect(open(met, 'chord.open')).toBe(true)
    const ctx = openContextOf(met, NOW)
    const after = { ...ctx.ratings, 'fret.single-string': 62, 'fret.cross-string': 61 }
    expect(unlockMilestones(SKILLS, ctx.ratings, after, NOW, { attempts: ctx.attempts }).map((x) => x.skillId)).not.toContain('chord.open')
    // Without the practice it is closed, and opening it is news.
    expect(open(model({ 'fret.single-string': 30, 'fret.cross-string': 40 }), 'chord.open')).toBe(false)
    expect(unlockMilestones(SKILLS, ctx.ratings, after, NOW).map((x) => x.skillId)).toContain('chord.open')
  })

  it('a skill a finished lesson taught is open even for a learner whose ratings are all low', () => {
    const weak = model({ 'fret.single-string': 12, 'chord.changes-open': 20 })
    expect(open(weak, 'chord.changes-open')).toBe(false)
    expect(open(weak, 'chord.changes-open', ['chord.changes-open'])).toBe(true)
  })

  it('reads what the lessons taught from the lesson rows: finished lessons only, each skill once', () => {
    expect(taughtSkillIds([])).toEqual([])
    const rows = COURSE.map((l, i) => ({ id: l.id, status: i < 6 ? ('done' as const) : ('available' as const) }))
    const taught = taughtSkillIds(rows)
    expect(taught).toEqual([...new Set(COURSE.slice(0, 6).flatMap((l) => (l.drill ? [l.drill.skillId] : [])))])
    expect(taught).toContain('chord.changes-open')
    expect(taught).not.toContain('chord.strum-patterns')
    // The skill map reads the same rows, so a weak graduate's chord changes are not drawn locked.
    const weak = model({ 'fret.single-string': 12, 'chord.changes-open': 20 })
    expect(open(weak, 'chord.changes-open', taught)).toBe(true)
  })

  it('agrees with the planner for every skill: what may be pinned as the main exercise is exactly what is open', () => {
    const lesson = { attempts: 3, lastPracticedAt: NOW - DAY }
    const cases = [shaky, solid, model({ 'fret.single-string': 26, 'chord.open': 26, 'chord.changes-open': 53 }, { 'chord.changes-open': lesson, 'chord.open': lesson }), model({})]
    for (const m of cases) {
      for (const skill of SKILLS) {
        const plan = planSession({ model: m, skills: SKILLS, library: [], prefs: { dailyMinutes: 20, goals: [], pinnedSkillId: skill.id }, now: new Date(NOW), daysSinceLastSession: 1 })
        const focus = plan.blocks.find((b) => b.kind === 'focus')
        const pinnedWon = focus !== undefined && 'skillId' in focus && focus.skillId === skill.id && /pinned/.test(focus.reason)
        expect(pinnedWon, skill.id).toBe(open(m, skill.id))
      }
    }
  })

  it('names everything under a skill that is not solid yet, nearest first', () => {
    const names = missingPrerequisites(SKILLS_BY_ID['chord.barre'], openContextOf(shaky, NOW).ratings, SKILLS).map((s) => s.id)
    expect(names).toEqual(['chord.open'])
    const none = missingPrerequisites(SKILLS_BY_ID['chord.barre'], {}, SKILLS).map((s) => s.id)
    expect(none).toEqual(['chord.changes-open', 'chord.open', 'fret.cross-string', 'fret.single-string'])
  })
})

describe('what the lessons taught, for a course that is given', () => {
  // Stand-ins for three singing lessons: one runs a tool and drills nothing.
  const lesson = (id: string, skillId?: string): Lesson =>
    ({ id, drill: skillId ? { skillId } : null }) as unknown as Lesson
  const course = [lesson('v01-voice'), lesson('v03-match', 'voice.pitch.match'), lesson('v04-steps', 'voice.pitch.steps'), lesson('v10-song', 'voice.pitch.match')]
  const rows = [
    { id: 'v01-voice', status: 'done' },
    { id: 'v03-match', status: 'done' },
    { id: 'v04-steps', status: 'available' },
    { id: 'v10-song', status: 'done' },
    { id: 'l01-hold', status: 'done' },
  ]

  it('reads the finished lessons of that course only: its drills, in its order, each skill once', () => {
    expect(taughtSkillIds(rows, course)).toEqual(['voice.pitch.match'])
    expect(taughtSkillIds(rows.map((r) => ({ ...r, status: 'done' })), course)).toEqual(['voice.pitch.match', 'voice.pitch.steps'])
    expect(taughtSkillIds([], course)).toEqual([])
  })

  it('without a course it is the guitar course, as before: lesson rows of another course teach it nothing', () => {
    expect(taughtSkillIds(rows)).toEqual(['basics.open-strings'])
    expect(taughtSkillIds(rows)).toEqual(taughtSkillIds(rows, COURSE))
  })
})
