import 'fake-indexeddb/auto'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ILLUSTRATION_LABELS, Illustration } from '../components/diagrams'
import { db } from '../db/db'
import { DEFAULT_RANGES, easyRange } from '../music/keys'
import { VOCAL_SONGS, VOICE_LEVELS, songKey, songSpan, vocalSong } from '../songs/vocal'
import { GENERATORS } from '../training/exercises'
import { instrumentOfLessonId, instrumentOfSkillId, skillById, type InstrumentId } from '../training/instruments'
import { defaultProfile, loadProfile, saveProfile } from '../training/store'
import type { Profile } from '../training/types'
import { taughtSkillIds } from '../training/unlock'
import { COURSE, courseOfLesson, lessonById, lessonPlayFor, lessonTool, nextAvailableLesson, nextLessonAfter, songStepLabel, unlockedSongIds } from './course'
import { finishLesson } from './finish'
import { courseProgress } from './store'
import type { IllustrationId, Lesson, LessonProgress } from './types'
import { VOICE_COURSE, VOICE_DEFAULT_GOAL_SONG_ID, VOICE_GOAL_SONG_IDS } from './voiceCourse'

/**
 * The Coach's "the course is finished" is a stand-in here. finish.ts hands it the instrument of the
 * lesson as its second argument, and the stand-in records what it was handed and does what the
 * contract between the two says: the profile row of that instrument gets its finish time. So these
 * tests are about finish.ts alone, and which instrument it names. The real pair is run together in
 * src/training/coach.voice.test.ts.
 */
const coach = vi.hoisted(() => ({ completeFirstSteps: vi.fn() }))
vi.mock('../training/coach', () => coach)

const IDS = ['v01-voice', 'v02-meet', 'v03-match', 'v04-steps', 'v05-words', 'v06-five', 'v07-hold', 'v08-jumps', 'v09-slides', 'v10-song']

/** Everything a learner reads in a lesson, with where it stands. */
function textsOf(lesson: Lesson): Array<[where: string, text: string]> {
  const out: Array<[string, string]> = [
    [`${lesson.id} title`, lesson.title],
    [`${lesson.id} subtitle`, lesson.subtitle],
    [`${lesson.id} done`, lesson.done],
  ]
  if (lesson.drill) out.push([`${lesson.id} hint`, lesson.drill.hint])
  for (const card of lesson.learn) {
    out.push([`${lesson.id} "${card.title}" title`, card.title])
    for (const p of card.paragraphs) out.push([`${lesson.id} "${card.title}"`, p])
    for (const m of card.mistakes ?? []) out.push([`${lesson.id} "${card.title}" mistake`, m])
  }
  return out
}
const ALL_TEXT = VOICE_COURSE.flatMap(textsOf)
const drills = VOICE_COURSE.flatMap((lesson) => (lesson.drill ? [{ lesson, drill: lesson.drill, skill: skillById(lesson.drill.skillId) }] : []))
const lessonOf = (number: number) => VOICE_COURSE[number - 1]
/** True when the text holds the phrase as whole words: "lower" does not say "low", and "humming" does not say "mm". */
const says = (text: string, phrase: string) => new RegExp(`(^|[^a-z])${phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(text.toLowerCase())

describe('the singing course', () => {
  it('has ten lessons, v01 to v10, numbered in order and all on the singing side', () => {
    expect(VOICE_COURSE.map((l) => l.id)).toEqual(IDS)
    VOICE_COURSE.forEach((l, i) => {
      expect(l.number, l.id).toBe(i + 1)
      expect(instrumentOfLessonId(l.id), l.id).toBe('voice')
    })
    // The lesson table is keyed by id alone: a singing lesson must never share one with a guitar lesson.
    expect(COURSE.map((l) => l.id).filter((id) => IDS.includes(id))).toEqual([])
  })

  it('keeps every lesson short: four to six minutes, two to four cards', () => {
    for (const l of VOICE_COURSE) {
      expect(l.minutes, l.id).toBeGreaterThanOrEqual(4)
      expect(l.minutes, l.id).toBeLessThanOrEqual(6)
      expect(l.learn.length, l.id).toBeGreaterThanOrEqual(2)
      expect(l.learn.length, l.id).toBeLessThanOrEqual(4)
    }
  })

  it('writes short plain cards: a few short paragraphs, and every mistake as "If … then …"', () => {
    for (const l of VOICE_COURSE) {
      expect(l.title.length, l.id).toBeGreaterThan(3)
      expect(l.subtitle.length, l.id).toBeGreaterThan(10)
      expect(l.done.length, l.id).toBeGreaterThan(20)
      expect(l.done.length, l.id).toBeLessThan(220)
      for (const c of l.learn) {
        const where = `${l.id} "${c.title}"`
        expect(c.title.length, where).toBeLessThanOrEqual(45)
        // Three or four short paragraphs a card, and none of them a block of text: two sentences at most.
        expect(c.paragraphs.length, where).toBeGreaterThanOrEqual(3)
        expect(c.paragraphs.length, where).toBeLessThanOrEqual(4)
        for (const p of c.paragraphs) {
          expect(p.length, p).toBeLessThan(220)
          expect(p.split(/(?<=[.!?])\s+(?=[A-Z"])/).length, p).toBeLessThanOrEqual(2)
        }
        expect((c.mistakes ?? []).length, where).toBeGreaterThanOrEqual(1)
        expect((c.mistakes ?? []).length, where).toBeLessThanOrEqual(3)
        for (const m of c.mistakes ?? []) {
          expect(m, where).toMatch(/^If .* then /)
          expect(m.length, m).toBeLessThan(220)
        }
      }
    }
  })

  it('hands a singer no more to read on one card than a guitarist ever gets', () => {
    // The same teacher wrote both courses. The longest card of the guitar course is 395 characters and
    // seven sentences (measured); a card that asks for more reading than that is two cards.
    const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+(?=[A-Z"])/).length
    for (const l of VOICE_COURSE) {
      for (const c of l.learn) {
        const where = `${l.id} "${c.title}"`
        expect(c.paragraphs.join(' ').length, where).toBeLessThanOrEqual(400)
        expect(c.paragraphs.reduce((n, p) => n + sentencesOf(p), 0), where).toBeLessThanOrEqual(7)
      }
    }
  })

  it('says every sentence only once', () => {
    const sentences = ALL_TEXT.filter(([where]) => !where.endsWith('title')).map(([, text]) => text)
    expect(sentences.filter((s, i) => sentences.indexOf(s) !== i)).toEqual([])
  })

  it('uses no word from the list a singer must never read', () => {
    // docs/SINGING.md §7 and §10: no numbers a beginner cannot use, nothing that blames, nothing that asks for more voice.
    const banned = /\b(bpm|ratings?|accuracy|reps?|tiers?|elo|push(es|ed|ing)?|belt(s|ed|ing)?|louder|loudly|as loud|tone[- ]deaf|wrong|fail(s|ed|ure|ing)?|bad|badly|mistakes?|errors?)\b/i
    for (const [where, text] of ALL_TEXT) expect(text, where).not.toMatch(banned)
  })

  it('uses no musician\'s word a beginner has not been given', () => {
    const jargon = /\b(cents?|semitones?|hz|hertz|intervals?|scales?|keys?|tempo|pitch(es|ed)?|vibrato|larynx|diaphragm|registers?|falsetto|head voice|chest voice|thirds?|fifths?|triads?|chords?|eighths?|quarters?|major|minor)\b/i
    for (const [where, text] of ALL_TEXT) {
      // "Chords" is said once, where the last lesson tells what the guide plays with headphones on.
      if (where.startsWith('v10-song') && /guitar/i.test(text)) continue
      expect(text, where).not.toMatch(jargon)
    }
    // "Octave" is the one word the result cards use ("You sang it an octave lower. That counts."), so
    // lesson 2 gives it, once, and nobody else leans on it.
    const octave = ALL_TEXT.filter(([, text]) => /\boctaves?\b/i.test(text))
    expect(octave.map(([where]) => where.slice(0, 8))).toEqual(['v02-meet'])
  })

  it('never writes {left} or {right}: nothing in singing depends on a hand', () => {
    for (const [where, text] of ALL_TEXT) expect(text, where).not.toMatch(/[{}]/)
  })

  it('promises nothing, and says nothing about health beyond "stop if it hurts or you feel dizzy"', () => {
    const promise = /\b(guarantee[ds]?|promise[ds]?|in no time|soon you|you will (soon|always|never)|will sound|perfect(ly)?)\b/i
    const medical = /\b(damage[ds]?|injur\w*|harm(s|ed|ful|less)?|heal(s|ed|thy|th)?|cure[ds]?|nodules?|vocal (cords?|folds?)|strain(s|ed|ing)?|safe(ly)?|medical|therap\w*)\b/i
    for (const [where, text] of ALL_TEXT) {
      expect(text, where).not.toMatch(promise)
      expect(text, where).not.toMatch(medical)
    }
  })

  it('says in the first lesson what a shy beginner needs to hear before singing a note', () => {
    const first = textsOf(lessonOf(1)).map(([, text]) => text).join(' ')
    expect(first).toMatch(/nobody is listening/i)
    expect(first).toMatch(/\bcracks?\b/i)
    expect(first).toMatch(/\bwobbles?\b/i)
    expect(first).toMatch(/should never hurt/i)
    expect(first).toMatch(/\bdizzy\b/i)
    // ...and once, plainly, what the app is not.
    expect(ALL_TEXT.filter(([, text]) => /not a voice doctor/i.test(text))).toHaveLength(1)
    expect(first).toMatch(/not a voice doctor/i)
  })

  it('tells the singer to stop when dizzy wherever long breaths are practised', () => {
    const hold = textsOf(lessonOf(7)).map(([, text]) => text).join(' ')
    expect(hold).toMatch(/\bdizzy\b/i)
    expect(hold).toMatch(/breathe normally/i)
  })
})

describe('the drawings of the singing course', () => {
  const pictures = (lesson: Lesson) => lesson.learn.flatMap((c) => (c.illustration ? [c.illustration] : []))
  const draw = (id: IllustrationId) => renderToStaticMarkup(createElement(Illustration, { id }))
  /** The words drawn inside a picture, caption by caption. */
  const drawnWords = (id: IllustrationId) => [...draw(id).matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1].replace(/<[^>]*>/g, ''))

  it('are all drawn: a mistyped id would show an empty frame', () => {
    for (const l of VOICE_COURSE) for (const id of pictures(l)) expect(Object.keys(ILLUSTRATION_LABELS), `${l.id} ${id}`).toContain(id)
  })

  it('are the seven singing drawings, each on the lesson it was drawn for', () => {
    expect(VOICE_COURSE.map(pictures)).toEqual([
      ['voice-posture', 'voice-phone'],
      ['pitch-ladder'],
      ['voice-lanes'],
      [],
      ['voice-mouth'],
      [],
      ['voice-breath'],
      [],
      ['voice-slide'],
      [],
    ])
  })

  it('are spoken of in the words drawn in them', () => {
    for (const l of VOICE_COURSE) {
      for (const card of l.learn) {
        if (!card.illustration) continue
        const text = [card.title, ...card.paragraphs, ...(card.mistakes ?? [])].join(' ')
        const drawn = drawnWords(card.illustration)
        expect(drawn.length, card.illustration).toBeGreaterThan(0)
        for (const words of drawn) expect(says(text, words), `${l.id} "${card.title}" does not say "${words}", which its drawing shows`).toBe(true)
      }
    }
  })
})

describe('what the singing lessons practise', () => {
  it('gives every lesson a middle step: a tool in the first two, a practice round from then on', () => {
    expect(VOICE_COURSE.map((l) => l.tool ?? (l.drill ? 'drill' : 'nothing'))).toEqual(['range', 'match', ...Array.from({ length: 8 }, () => 'drill')])
    // A tool stands where a practice round would: a lesson never has both.
    for (const l of [...COURSE, ...VOICE_COURSE]) if (l.tool) expect(l.drill, l.id).toBeNull()
  })

  it('points every practice round at a singing skill and at that skill\'s own exercise', () => {
    expect(drills).toHaveLength(8)
    for (const { lesson, drill, skill } of drills) {
      expect(skill, lesson.id).toBeDefined()
      expect(instrumentOfSkillId(drill.skillId), lesson.id).toBe('voice')
      expect(GENERATORS[drill.generatorId], lesson.id).toBeDefined()
      // The exercise daily practice carries on with, so the lesson and the plan sing the same thing.
      expect(skill!.generators, lesson.id).toContain(drill.generatorId)
    }
  })

  it('practises what the design lists, lesson by lesson', () => {
    expect(drills.map(({ drill }) => [drill.skillId, drill.tempo, drill.params?.step])).toEqual([
      ['voice.pitch.match', 60, 0],
      ['voice.pitch.steps', 60, undefined],
      ['voice.pitch.echo', 72, 0],
      ['voice.pitch.five-note', 60, undefined],
      ['voice.pitch.hold', 60, 0],
      ['voice.interval.thirds', 56, undefined],
      ['voice.range.slides', 60, 0],
      ['voice.pitch.match', 60, 1],
    ])
  })

  it('never sings slower than a skill may be sung, nor quicker than it starts', () => {
    for (const { lesson, drill, skill } of drills) {
      // Under the floor a line outlasts the breath; above the starting pace a first try is too quick.
      expect(drill.tempo, lesson.id).toBeGreaterThanOrEqual(skill!.minTempo ?? 0)
      expect(drill.tempo, lesson.id).toBeLessThanOrEqual(skill!.startTempo)
    }
  })

  it('names a step for every skill that climbs a ladder, and for no other', () => {
    for (const { lesson, drill, skill } of drills) {
      const steps = skill!.steps
      if (!steps) {
        expect(drill.params?.step, lesson.id).toBeUndefined()
        continue
      }
      // Without it the round would be recorded as step 0 whatever was sung.
      expect(Number.isInteger(drill.params?.step), lesson.id).toBe(true)
      expect(drill.params!.step as number, lesson.id).toBeGreaterThanOrEqual(0)
      expect(drill.params!.step as number, lesson.id).toBeLessThan(steps.length)
    }
  })

  it('gives three rounds, lets seven notes in ten pass, and says what to do in one plain line', () => {
    for (const { lesson, drill } of drills) {
      expect(drill.rounds, lesson.id).toBe(3)
      expect(drill.passAccuracy, lesson.id).toBe(0.7)
      expect(drill.hint.length, lesson.id).toBeGreaterThan(20)
      expect(drill.hint.length, lesson.id).toBeLessThan(220)
    }
  })

  it('never drills a skill before the skills it builds on', () => {
    const drilled = new Set<string>()
    for (const { lesson, drill, skill } of drills) {
      for (const needed of skill!.prerequisites) expect(drilled.has(needed), `${lesson.id}: ${drill.skillId} builds on ${needed}`).toBe(true)
      drilled.add(drill.skillId)
    }
  })

  it('drills a skill beyond the first one by lesson 4, so a graduate is past the beginner\'s plan', () => {
    expect(skillById(lessonOf(3).drill!.skillId)!.tier).toBe(0)
    expect(skillById(lessonOf(4).drill!.skillId)!.tier).toBe(1)
    // What the Coach reads from the finished lessons: every skill the course drilled, once, in course order.
    const done = VOICE_COURSE.map((l) => ({ id: l.id, status: 'done' }))
    expect(taughtSkillIds(done, VOICE_COURSE)).toEqual(['voice.pitch.match', 'voice.pitch.steps', 'voice.pitch.echo', 'voice.pitch.five-note', 'voice.pitch.hold', 'voice.interval.thirds', 'voice.range.slides'])
    expect(taughtSkillIds(done)).toEqual([])
  })
})

describe('the songs of the singing course', () => {
  const sungBy = (lesson: Lesson) => (lesson.id === 'v10-song' ? VOICE_GOAL_SONG_IDS : lesson.play ? [lesson.play.songId] : [])
  const COURSE_SONGS = [...new Set(VOICE_COURSE.flatMap(sungBy))]

  it('are songs to sing that exist, sung at full speed and whole', () => {
    for (const l of VOICE_COURSE) {
      for (const id of l.unlocks) expect(vocalSong(id), `${l.id} unlocks ${id}`).toBeDefined()
      if (!l.play) continue
      expect(vocalSong(l.play.songId), l.id).toBeDefined()
      // A song is never slowed down (a slow line outlasts the breath) and never thinned out.
      expect(l.play.speed, l.id).toBe(1)
      expect(l.play.view, l.id).toBe('outline')
      expect(l.play.fingers, l.id).toBeUndefined()
      expect(VOICE_LEVELS[l.play.level], l.id).toBeDefined()
    }
  })

  it('are sung as the design lists: echoed first, then with the words', () => {
    expect(VOICE_COURSE.map((l) => (l.play ? [l.play.songId, l.play.level] : null))).toEqual([
      null,
      null,
      ['sing-hot-cross-buns', 0],
      ['sing-hot-cross-buns', 1],
      ['sing-hot-cross-buns', 2],
      ['sing-mary-lamb', 0],
      ['sing-mary-lamb', 2],
      ['sing-ode-to-joy', 1],
      ['sing-saints', 1],
      [VOICE_DEFAULT_GOAL_SONG_ID, 2],
    ])
  })

  it('open in the order the songs themselves say', () => {
    // A song's `lessonLevel` is the lesson after which the Coach may plan it; the course has to open it then.
    for (const song of VOCAL_SONGS) {
      const opener = VOICE_COURSE.filter((l) => l.unlocks.includes(song.id)).map((l) => l.number)
      expect(opener, song.id).toEqual(song.lessonLevel < 10 ? [song.lessonLevel] : [])
    }
    expect(unlockedSongIds(VOICE_COURSE.map((l) => ({ id: l.id, status: 'done' as const })), VOICE_COURSE)).toEqual([
      'sing-hot-cross-buns',
      'sing-mary-lamb',
      'sing-ode-to-joy',
      'sing-aunt-rhody',
      'sing-saints',
      'sing-london-bridge',
      'sing-jingle-bells',
      'sing-twinkle',
    ])
  })

  it('fit the smallest range the app stores: eight notes from the lowest to the highest', () => {
    expect(COURSE_SONGS.sort()).toEqual(['sing-hot-cross-buns', 'sing-mary-lamb', 'sing-ode-to-joy', 'sing-saints'])
    for (const id of COURSE_SONGS) {
      const song = vocalSong(id)!
      const span = songSpan(song)
      expect(span.high - span.low, id).toBeLessThanOrEqual(7)
      expect(songKey(song, DEFAULT_RANGES.lower).fits, id).toBe(true)
      expect(songKey(song, DEFAULT_RANGES.higher).fits, id).toBe(true)
      for (let easy = 40; easy <= 80; easy++) expect(songKey(song, easyRange(easy)).fits, `${id} around ${easy}`).toBe(true)
    }
  })

  it('name in a lesson\'s closing line only songs that every voice can sing', () => {
    // London Bridge and Twinkle open with the course but are nine notes wide: a singer with the smallest
    // range finds them under "Comes later", so no lesson may say they are waiting.
    for (const l of VOICE_COURSE) {
      for (const song of VOCAL_SONGS) {
        if (!l.done.includes(song.title.split(',')[0])) continue
        const span = songSpan(song)
        expect(span.high - span.low, `${l.id} names ${song.title}`).toBeLessThanOrEqual(7)
      }
    }
  })

  describe('the last lesson', () => {
    const last = lessonOf(10)

    it('sings the singer\'s own goal song, at "Whole tune"', () => {
      for (const id of VOICE_GOAL_SONG_IDS) expect(lessonPlayFor(last, id)).toEqual({ songId: id, level: 2, speed: 1, view: 'outline' })
    })

    it('sings Ode to Joy when no goal was picked, or one the course cannot end on', () => {
      expect(VOICE_DEFAULT_GOAL_SONG_ID).toBe('sing-ode-to-joy')
      expect(VOICE_GOAL_SONG_IDS).toContain(VOICE_DEFAULT_GOAL_SONG_ID)
      for (const goal of [undefined, '', 'sing-twinkle', 'sing-amazing-grace', 'ode-to-joy', 'no-such-song']) {
        expect(lessonPlayFor(last, goal)?.songId, String(goal)).toBe('sing-ode-to-joy')
      }
    })

    it('offers three goals, each a song an earlier lesson has already sung', () => {
      expect([...VOICE_GOAL_SONG_IDS].sort()).toEqual(['sing-mary-lamb', 'sing-ode-to-joy', 'sing-saints'])
      const met = new Set(VOICE_COURSE.slice(0, 9).flatMap((l) => (l.play ? [l.play.songId] : [])))
      for (const id of VOICE_GOAL_SONG_IDS) expect(met.has(id), id).toBe(true)
    })

    it('hands back a play nobody can change the course through', () => {
      // With a goal and without one: a screen that kept the level it reached on this object would otherwise
      // rewrite the lesson, for this singer and for whoever opens it next.
      for (const goal of ['sing-saints', 'sing-ode-to-joy', undefined, 'no-such-song']) {
        const play = lessonPlayFor(last, goal)!
        expect(() => {
          play.level = 5
        }, String(goal)).toThrow(TypeError)
        expect(last.play, String(goal)).toEqual({ songId: 'sing-ode-to-joy', level: 2, speed: 1, view: 'outline' })
        expect(lessonPlayFor(last, goal)!.level, String(goal)).toBe(2)
      }
    })

    it('hands back the very same play each time it is asked for the same goal', () => {
      // A screen asks on every draw. A new object each time would look like a new song to anything that
      // watches the play (the lesson's song step prepares its notes and its sound from it).
      for (const goal of ['sing-saints', 'sing-mary-lamb', 'sing-ode-to-joy', undefined, 'no-such-song']) {
        expect(lessonPlayFor(last, goal), String(goal)).toBe(lessonPlayFor(last, goal))
      }
      // No goal, the goal that is the lesson's own song, and a goal the course cannot end on are one answer.
      expect(lessonPlayFor(last, 'sing-ode-to-joy')).toBe(lessonPlayFor(last))
      expect(lessonPlayFor(last, 'no-such-song')).toBe(lessonPlayFor(last))
      expect(lessonPlayFor(last, 'sing-saints')).not.toBe(lessonPlayFor(last, 'sing-mary-lamb'))
    })

    it('remembers a play for the lesson it was asked of, and for no other', () => {
      // A last lesson of its own (a later course, a test) with another level: it must not get the play remembered for this one.
      const other: Lesson = { ...last, play: { ...last.play!, level: 0 } }
      expect(lessonPlayFor(last, 'sing-saints')).toEqual({ songId: 'sing-saints', level: 2, speed: 1, view: 'outline' })
      expect(lessonPlayFor(other, 'sing-saints')).toEqual({ songId: 'sing-saints', level: 0, speed: 1, view: 'outline' })
      expect(lessonPlayFor(other)).toEqual({ songId: 'sing-ode-to-joy', level: 0, speed: 1, view: 'outline' })
      expect(lessonPlayFor({ ...last, play: null }, 'sing-saints')).toBeNull()
    })

    it('says what is heard on the phone speaker and what with headphones, as it is', () => {
      const level = VOICE_LEVELS[last.play!.level]
      const card = last.learn.find((c) => /headphones/i.test(c.title))!
      const text = card.paragraphs.join(' ')
      // On the speaker the click goes on while the singer sings (the first card says so): that is not "quiet".
      const speaker = card.paragraphs.find((p) => /phone speaker/.test(p))!
      expect(speaker).toMatch(/\bclicks?\b/)
      expect(speaker).not.toMatch(/\b(quiet|silent)\b/)
      expect(last.learn[0].paragraphs.join(' ')).toMatch(/you hear only the click/)
      expect(level.echo).toBe(0)
      // With headphones the guide sings the singer's own notes: true of the levels on which it doubles them.
      expect(text).toMatch(/a guitar strums the chords and a voice sings your notes with you/)
      expect(level.doubled).toBe(true)
      // For a singer who said in set-up that they wear headphones the guide is on already. Told to "tap the
      // speaker icon to turn the guide on", they would turn it off.
      expect(text).not.toMatch(/tap the speaker icon to turn/i)
      expect(text).toMatch(/The speaker icon turns it on and off/)
    })
  })

  it('leave every other lesson\'s song alone, whatever the goal', () => {
    for (const l of [...COURSE, ...VOICE_COURSE.slice(0, 9)]) expect(lessonPlayFor(l, 'sing-saints'), l.id).toEqual(l.play)
  })
})

describe('what the lessons say about their songs is true of the songs', () => {
  const said = (number: number) => textsOf(lessonOf(number)).map(([, text]) => text).join(' ')
  /** The name a lesson calls a song by: its title, without the long tail of "When the Saints Go Marching In". */
  const shortTitle = (title: string) => title.split(' Go ')[0].split(',')[0]
  const sung = (id: string) => vocalSong(id)!.lines.map((line) => line.filter(([offset]) => offset !== null) as [number, number, string?][])

  it('the closing line says how the song was sung: echoed, or with its words', () => {
    for (const l of VOICE_COURSE) {
      if (!l.play) continue
      const level = VOICE_LEVELS[l.play.level]
      expect(/\bechoed\b/.test(l.done), l.id).toBe(level.echo > 0)
      if (/one line at a time|line by line/.test(l.done)) expect(level.echo, l.id).toBe(1)
      if (/two lines at a time/.test(l.done)) expect(level.echo, l.id).toBe(2)
      expect(/with its words|whole song/.test(l.done), l.id).toBe(level.shown === 'words')
    }
  })

  it('the closing line names the lesson\'s own song, and of other songs only ones the lesson opens', () => {
    for (const l of VOICE_COURSE.slice(0, 9)) {
      if (l.play) expect(l.done, l.id).toContain(shortTitle(vocalSong(l.play.songId)!.title))
      for (const song of VOCAL_SONGS) {
        if (!l.done.includes(shortTitle(song.title)) || song.id === l.play?.songId) continue
        expect(l.unlocks, `${l.id} says ${song.title} is open`).toContain(song.id)
      }
    }
  })

  it('a card that says "the app sings a line, you sing it back on la" belongs to a lesson that echoes line by line', () => {
    const echoing = VOICE_COURSE.filter((l) => /sings a line.*you sing it back on "la"/.test(textsOf(l).map(([, t]) => t).join(' ')))
    expect(echoing.map((l) => l.number)).toEqual([3, 6])
    for (const l of echoing) expect(VOICE_LEVELS[l.play!.level]).toMatchObject({ echo: 1, shown: 'la' })
  })

  it('a card that says "one note to start" belongs to a lesson that gives the starting note only', () => {
    const alone = VOICE_COURSE.filter((l) => /one (starting note|note to start)/.test(l.learn.flatMap((c) => c.paragraphs).join(' ')))
    expect(alone.map((l) => l.number)).toEqual([5, 10])
    for (const l of alone) expect(VOICE_LEVELS[l.play!.level]).toMatchObject({ echo: 0, shown: 'words' })
  })

  it('Hot Cross Buns is what lessons 4 and 5 say it is', () => {
    const lines = sung('sing-hot-cross-buns')
    expect(said(4)).toMatch(/Hot Cross Buns is made of these same three notes, coming down: 3, 2, 1/)
    expect([...new Set(lines.flat().map(([offset]) => offset))].sort()).toEqual([0, 2, 4])
    expect(lines[0].map(([offset]) => offset)).toEqual([4, 2, 0])
    expect(said(5)).toMatch(/the first two lines start on the same note, and the last line starts on the note you have just ended on/)
    expect(lines).toHaveLength(3)
    expect(lines[1][0][0]).toBe(lines[0][0][0])
    expect(lines[2][0][0]).toBe(lines[1][lines[1].length - 1][0])
    // "the "o" in "hot", the "u" in "buns""
    expect(lines.flat().map(([, , syllable]) => syllable?.toLowerCase())).toEqual(expect.arrayContaining(['hot', 'buns']))
  })

  it('Mary Had a Little Lamb ends on its longest note, as lesson 7 says', () => {
    expect(said(7)).toMatch(/Mary Had a Little Lamb, ends on its longest note, the word "snow"/)
    const notes = sung('sing-mary-lamb').flat()
    const [, beats, word] = notes[notes.length - 1]
    expect(word).toBe('snow')
    for (const [, other] of notes.slice(0, -1)) expect(other).toBeLessThan(beats)
  })

  it('Ode to Joy moves in steps and When the Saints jumps, as lesson 8 says', () => {
    expect(said(8)).toMatch(/Ode to Joy, moves in steps all the way\. The jumps are for the song that opens after this lesson, When the Saints/)
    const widest = (id: string) => Math.max(...sung(id).flatMap((line) => line.slice(1).map(([offset], i) => Math.abs(offset - line[i][0]))))
    // A step is the note next door: two of the twelve small steps at the most.
    expect(widest('sing-ode-to-joy')).toBeLessThanOrEqual(2)
    expect(widest('sing-saints')).toBeGreaterThan(2)
    expect(lessonOf(8).unlocks).toContain('sing-saints')
  })
})

describe('finding a lesson in two courses', () => {
  const rows = (course: Lesson[], statuses: LessonProgress['status'][]): LessonProgress[] => course.map((l, i) => ({ id: l.id, status: statuses[i] ?? 'locked' }))

  it('finds a lesson of either course by its id', () => {
    expect(lessonById('v03-match')).toBe(VOICE_COURSE[2])
    expect(lessonById('l03-first-frets')).toBe(COURSE[2])
    expect(lessonById('v99-nothing')).toBeUndefined()
    expect(lessonById('')).toBeUndefined()
  })

  it('looks in one course only when it is given one', () => {
    expect(lessonById('v03-match', COURSE)).toBeUndefined()
    expect(lessonById('l03-first-frets', VOICE_COURSE)).toBeUndefined()
    expect(lessonById('v03-match', VOICE_COURSE)).toBe(VOICE_COURSE[2])
  })

  it('knows which course a lesson is part of', () => {
    for (const l of VOICE_COURSE) expect(courseOfLesson(l.id), l.id).toBe(VOICE_COURSE)
    for (const l of COURSE) expect(courseOfLesson(l.id), l.id).toBe(COURSE)
    expect(courseOfLesson('unknown')).toBe(COURSE)
  })

  it('goes on to the next lesson of the same course, and stops at its end', () => {
    expect(nextLessonAfter('v01-voice')?.id).toBe('v02-meet')
    expect(nextLessonAfter('v09-slides')?.id).toBe('v10-song')
    expect(nextLessonAfter('v10-song')).toBeUndefined()
    expect(nextLessonAfter('l01-hold')?.id).toBe('l02-tune')
    // The guitar course does not run on into the singing one.
    expect(nextLessonAfter('l10-riff')).toBeUndefined()
    expect(nextLessonAfter('unknown')).toBeUndefined()
    expect(nextLessonAfter('v01-voice', COURSE)).toBeUndefined()
  })

  it('offers the open lesson of the course asked for: guitar unless told otherwise', () => {
    const both = [...rows(COURSE, ['done', 'available']), ...rows(VOICE_COURSE, ['done', 'done', 'available'])]
    expect(nextAvailableLesson(both)?.id).toBe('l02-tune')
    expect(nextAvailableLesson(both, VOICE_COURSE)?.id).toBe('v03-match')
    // An open singing lesson is no guitar lesson to start, and the other way round.
    expect(nextAvailableLesson(rows(VOICE_COURSE, ['available']))).toBeUndefined()
    expect(nextAvailableLesson(rows(COURSE, ['available']), VOICE_COURSE)).toBeUndefined()
  })

  it('lists the songs opened by the finished lessons of the course asked for', () => {
    const both = [...rows(COURSE, ['done', 'done', 'done']), ...rows(VOICE_COURSE, ['done', 'done', 'done', 'done', 'done', 'available'])]
    expect(unlockedSongIds(both)).toEqual(['open-strings-groove', 'ode-to-joy'])
    expect(unlockedSongIds(both, VOICE_COURSE)).toEqual(['sing-hot-cross-buns', 'sing-mary-lamb'])
    expect(unlockedSongIds(rows(VOICE_COURSE, ['done', 'done', 'done', 'done']))).toEqual([])
  })

  it('names the tool a lesson runs where another has its practice round', () => {
    expect(lessonTool(lessonById('l02-tune')!)).toBe('tuner')
    expect(lessonTool(lessonById('v01-voice')!)).toBe('range')
    expect(lessonTool(lessonById('v02-meet')!)).toBe('match')
    for (const l of [...COURSE, ...VOICE_COURSE]) if (l.drill) expect(lessonTool(l), l.id).toBeUndefined()
    // The guitar course has one lesson with a tool, as it always had.
    expect(COURSE.filter((l) => lessonTool(l)).map((l) => l.id)).toEqual(['l02-tune'])
    // A lesson is never given two middle steps: should one ever carry both, its practice round is the one that runs.
    expect(lessonTool({ drill: VOICE_COURSE[2].drill, tool: 'range' })).toBeUndefined()
    expect(lessonTool({ drill: null })).toBeUndefined()
  })

  it('calls the song step by what is done in it', () => {
    for (const l of COURSE) expect(songStepLabel(l), l.id).toBe('Play')
    for (const l of VOICE_COURSE) expect(songStepLabel(l), l.id).toBe('Sing')
  })
})

describe('finishing a lesson of either course', () => {
  const guitarIds = COURSE.map((l) => l.id)
  const NOW = 1_700_000_000_000
  const running = (instrument: InstrumentId): Profile => ({ ...defaultProfile(1, instrument), experience: 'new', firstStepsStartedAt: 5, placementDoneAt: 5 })
  const lessonRows = (ids: string[], done: number): LessonProgress[] =>
    ids.map((id, i): LessonProgress => (i < done ? { id, status: 'done', completedAt: 2 } : { id, status: i === done ? 'available' : 'locked' }))

  beforeEach(async () => {
    await db.lessons.clear()
    await db.profile.clear()
    await saveProfile(running('guitar'))
    await saveProfile(running('voice'))
    coach.completeFirstSteps.mockReset()
    // What the Coach's function does, by its contract: the finish time goes on the profile of the instrument named.
    coach.completeFirstSteps.mockImplementation(async (now: number, instrument: InstrumentId = 'guitar') => {
      const profile = { ...(await loadProfile(instrument)), firstStepsDoneAt: now }
      await saveProfile(profile)
      return profile
    })
  })

  it('opens the next singing lesson and touches no guitar lesson', async () => {
    const guitar = lessonRows(guitarIds, 3)
    await db.lessons.bulkPut([...guitar, ...lessonRows(IDS, 0)])
    expect(await finishLesson('v01-voice', NOW)).toEqual({ courseComplete: false })
    expect((await courseProgress(IDS)).map((r) => r.status)).toEqual(['done', 'available', ...IDS.slice(2).map(() => 'locked')])
    expect((await db.lessons.get('v01-voice'))?.completedAt).toBe(NOW)
    expect(await courseProgress(guitarIds)).toEqual(guitar)
    expect(coach.completeFirstSteps).not.toHaveBeenCalled()
  })

  it('ends the singing course after its last lesson, on the singing profile only', async () => {
    await db.lessons.bulkPut([...lessonRows(guitarIds, 3), ...lessonRows(IDS, 9)])
    expect(await finishLesson('v10-song', NOW)).toEqual({ courseComplete: true })
    expect(coach.completeFirstSteps).toHaveBeenCalledTimes(1)
    expect(coach.completeFirstSteps).toHaveBeenCalledWith(NOW, 'voice')
    expect((await db.profile.get(2))?.firstStepsDoneAt).toBe(NOW)
    // The guitar course is still running, with its fourth lesson open.
    expect(await db.profile.get(1)).toEqual(running('guitar'))
    expect(nextAvailableLesson(await courseProgress(guitarIds))?.id).toBe(guitarIds[3])
  })

  it('ends the guitar course after its last lesson, on the guitar profile only', async () => {
    const voice = lessonRows(IDS, 4)
    await db.lessons.bulkPut([...lessonRows(guitarIds, 9), ...voice])
    expect(await finishLesson('l10-riff', NOW)).toEqual({ courseComplete: true })
    expect(coach.completeFirstSteps).toHaveBeenCalledTimes(1)
    expect(coach.completeFirstSteps).toHaveBeenCalledWith(NOW, 'guitar')
    expect((await db.profile.get(1))?.firstStepsDoneAt).toBe(NOW)
    expect(await db.profile.get(2)).toEqual(running('voice'))
    expect(await courseProgress(IDS)).toEqual(voice)
  })

  it('does not take the finished lessons of one course for the other\'s', async () => {
    // Every guitar lesson done, the singer on lesson 2: finishing it must not end anything.
    await db.lessons.bulkPut([...lessonRows(guitarIds, 10), ...lessonRows(IDS, 1)])
    expect(await finishLesson('v02-meet', NOW)).toEqual({ courseComplete: false })
    expect(coach.completeFirstSteps).not.toHaveBeenCalled()
    expect(await db.profile.get(2)).toEqual(running('voice'))
    expect(await db.profile.get(1)).toEqual(running('guitar'))
    expect(nextAvailableLesson(await courseProgress(IDS), VOICE_COURSE)?.id).toBe('v03-match')
  })

  it('opens the lesson after the one finished, also while an earlier one is still open', async () => {
    // A singer who looked ahead: lesson 2 is still open, lesson 5 is the one just finished.
    const voice = IDS.map((id, i): LessonProgress => ({ id, status: i === 0 ? 'done' : i === 1 ? 'available' : 'locked' }))
    await db.lessons.bulkPut([...lessonRows(guitarIds, 0), ...voice])
    expect(await finishLesson('v05-words', NOW)).toEqual({ courseComplete: false })
    const after = new Map((await courseProgress(IDS)).map((r) => [r.id, r.status]))
    expect(after.get('v05-words')).toBe('done')
    expect(after.get('v06-five')).toBe('available')
    expect(after.get('v02-meet')).toBe('available')
    expect(after.get('v07-hold')).toBe('locked')
    // Its number in the guitar course is not what was opened.
    expect((await db.lessons.get(guitarIds[5]))?.status).toBe('locked')
  })

  it('opens whichever singing lesson is left when lessons were done out of order', async () => {
    // Lessons 1 to 3 and the last one done before; now lesson 9. The guitar course has a lesson open too,
    // which must not pass for the singing course's open lesson.
    const voice = IDS.map((id, i): LessonProgress => ({ id, status: i < 3 || i === 9 ? 'done' : i === 8 ? 'available' : 'locked' }))
    await db.lessons.bulkPut([...lessonRows(guitarIds, 2), ...voice])
    expect(await finishLesson('v09-slides', NOW)).toEqual({ courseComplete: false })
    expect(nextAvailableLesson(await courseProgress(IDS), VOICE_COURSE)?.id).toBe('v04-steps')
    expect(coach.completeFirstSteps).not.toHaveBeenCalled()
  })

  it('finishes a guitar lesson as it always did', async () => {
    await db.lessons.bulkPut(lessonRows(guitarIds, 0))
    expect(await finishLesson('l01-hold', NOW)).toEqual({ courseComplete: false })
    expect((await courseProgress(guitarIds)).map((r) => r.status)).toEqual(['done', 'available', ...guitarIds.slice(2).map(() => 'locked')])
    expect(await db.lessons.count()).toBe(10)
    expect(await db.profile.get(1)).toEqual(running('guitar'))
    expect(coach.completeFirstSteps).not.toHaveBeenCalled()
  })

  it('stores nothing of a lesson whose course could not be ended', async () => {
    // One transaction: the last lesson must never be stored as done while the course still counts as running.
    await db.lessons.bulkPut(lessonRows(IDS, 9))
    coach.completeFirstSteps.mockRejectedValueOnce(new Error('no room left'))
    await expect(finishLesson('v10-song', NOW)).rejects.toThrow('no room left')
    expect((await db.lessons.get('v10-song'))?.status).toBe('available')
    expect(await db.profile.get(2)).toEqual(running('voice'))
  })
})
