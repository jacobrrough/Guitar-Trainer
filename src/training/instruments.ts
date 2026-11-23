/**
 * One app, two instruments. Everything that decides which side a stored thing belongs to, and which
 * skills and lessons a side has, is here, so loading, backup, reset and the screens cannot disagree.
 *
 * `SKILLS`, `SKILLS_BY_ID` and `COURSE` keep meaning guitar: tests pin them, and the guitar tempo
 * corrections in migrate.ts only know guitar ids. The voice lists live beside them, never inside them.
 *
 * (The id type is `InstrumentId` because `Instrument` already means guitar, bass or ukulele in src/music/tunings.ts.)
 */
import { voiceEnabled } from '../app/features'
import type { AppSettings } from '../app/settings'
import { COURSE } from '../lessons/course'
import type { Lesson } from '../lessons/types'
import { VOICE_COURSE } from '../lessons/voiceCourse'
import { SKILLS, SKILLS_BY_ID } from './skills'
import type { InstrumentId, SkillDef } from './types'
import { VOICE_SKILLS } from './voiceSkills'

export type { InstrumentId } from './types'

/** Rows stored before singing existed carry no stamp: they are guitar rows. */
export const instrumentOf = (row: { instrument?: InstrumentId }): InstrumentId => row.instrument ?? 'guitar'

/** The profile table holds one row per instrument: 1 is guitar (as it always was), 2 is singing. */
export const profileIdFor = (instrument: InstrumentId): 1 | 2 => (instrument === 'voice' ? 2 : 1)

/** By the id alone, not by the skill lists: a guitar state whose skill was retired is still a guitar state. */
export const instrumentOfSkillId = (id: string): InstrumentId => (id.startsWith('voice.') ? 'voice' : 'guitar')

/** Singing lessons are `v01-…` to `v10-…`; guitar lessons are `l01-…`. */
export const instrumentOfLessonId = (id: string): InstrumentId => (/^v\d\d-/.test(id) ? 'voice' : 'guitar')

/**
 * Singing blocks are `voice-${date}-${i}-${kind}`; guitar blocks keep their ids without a prefix.
 * Only for the blocks of a stored plan. A lesson drill is recorded through a stand-in block with the id
 * `lesson-${skillId}` (coach.ts), which reads as guitar here whatever the skill: ask `instrumentOfSkillId`
 * about its skill instead.
 */
export const instrumentOfBlockId = (id: string): InstrumentId => (id.startsWith('voice-') ? 'voice' : 'guitar')

export function skillsFor(instrument: InstrumentId): SkillDef[] {
  return instrument === 'voice' ? VOICE_SKILLS : SKILLS
}

/** A skill of either instrument; undefined for an id in neither list (callers decide whether that is an error). */
export function skillById(id: string): SkillDef | undefined {
  // Own-property check: `SKILLS_BY_ID` is a plain object, and an id like "constructor" must not find Object's.
  if (Object.hasOwn(SKILLS_BY_ID, id)) return SKILLS_BY_ID[id]
  return VOICE_SKILLS.find((s) => s.id === id)
}

export function courseFor(instrument: InstrumentId): Lesson[] {
  return instrument === 'voice' ? VOICE_COURSE : COURSE
}

/**
 * Which side the list pages show. Guitar until the voice side is switched on, whatever the setting says:
 * a setting left on 'voice' by a preview must not strand the device once the preview key is gone.
 */
export function activeInstrument(settings: Pick<AppSettings, 'instrument'>): InstrumentId {
  return voiceEnabled() && settings.instrument === 'voice' ? 'voice' : 'guitar'
}
