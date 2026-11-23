import { fingeringSentence } from './fingering'
import type { Lesson, LessonPlay, LessonProgress } from './types'
import { VOICE_COURSE, VOICE_GOAL_LESSON_ID, VOICE_GOAL_SONG_IDS } from './voiceCourse'

/**
 * The First steps course, in order. Card text is written for someone who has
 * never held a guitar: plain words, no jargon, string and finger numbers named.
 *
 * Where the fingers of a chord go is not typed here but written by `fingeringSentence` from the table
 * the chord boxes are drawn from. A left or right that depends on how the guitar is held is written
 * {left} or {right} and shown through `forHand`, so a left-handed learner reads what their mirrored
 * pictures show.
 *
 * `COURSE` is the guitar course and nothing else. The singing course is its own list (`VOICE_COURSE`
 * in voiceCourse.ts); the helpers under the list work on either.
 */
export const COURSE: Lesson[] = [
  {
    id: 'l01-hold',
    number: 1,
    title: 'Hold it, pick it',
    subtitle: 'Sit comfortably and play your first open strings',
    minutes: 5,
    learn: [
      {
        title: 'Sit and hold the guitar',
        illustration: 'sitting',
        paragraphs: [
          'Sit on a chair with your back fairly straight and both feet on the floor.',
          'Rest the curve of the guitar on your {right} thigh, so the neck points slightly up and to your {left}.',
          'Let your {right} forearm rest lightly on the top edge of the guitar.',
          'Your shoulders should feel loose, not lifted.',
        ],
        mistakes: [
          'If your shoulder aches, then the guitar is too high or you are hugging it too tightly, so let it rest on your leg instead.',
          'If the guitar keeps sliding, then sit a little further back in the chair.',
        ],
      },
      {
        title: 'Hold the pick',
        illustration: 'pick-grip',
        paragraphs: [
          'Pinch the pick between the pad of your thumb and the side of your bent index finger.',
          'Only the tip of the pick should poke out, about the size of a grain of rice.',
          'Hold it firmly enough that it will not fall, but keep your hand relaxed.',
        ],
        mistakes: [
          'If the pick spins or drops, then hold it a little closer to its point and squeeze a bit more.',
          'If the sound is scratchy, then show less of the pick and pluck with its tip.',
        ],
      },
      {
        title: 'Meet the six strings',
        illustration: 'string-names',
        paragraphs: [
          'The thickest string is the 6th string, and it is called low E.',
          'Going down to the thinnest, the strings are E, A, D, G, B and then high E, the 1st string.',
          'A handy phrase to remember them is: Eddie Ate Dynamite, Good Bye Eddie.',
          'Playing a string without pressing any fret is called playing it open.',
        ],
        mistakes: ['If you lose count of the strings, then remember the thickest is the 6th and the thinnest is the 1st.'],
      },
      {
        title: 'Where to put your phone',
        illustration: 'phone-placement',
        paragraphs: [
          'Stand your phone up about an arm’s length from the guitar, facing the sound hole or the amp.',
          'A quiet room helps the app hear you clearly.',
          'Headphones for the backing track make it much easier, because the phone then hears only your guitar.',
        ],
        mistakes: ['If the app seems deaf, then move the phone closer and pick a little more firmly.'],
      },
    ],
    drill: {
      skillId: 'basics.open-strings',
      generatorId: 'openStrings',
      params: { strings: 2, noteValue: 'half' },
      tempo: 50,
      rounds: 3,
      passAccuracy: 0.7,
      hint: 'Pick the two thickest strings in turn, the 6th and then the 5th, without pressing anything. Play each note as it reaches the line and let it ring.',
    },
    play: { songId: 'open-strings-groove', level: 0, speed: 0.85, view: 'outline' },
    unlocks: ['open-strings-groove'],
    done: 'You held the guitar, picked open strings in time and played along with a drum beat. That is a real start.',
  },
  {
    id: 'l02-tune',
    number: 2,
    title: 'In tune',
    subtitle: 'Tune each string so every note sounds as it should',
    minutes: 5,
    learn: [
      {
        title: 'Parts of the guitar',
        illustration: 'anatomy',
        paragraphs: [
          'The big hollow part is the body, and the long part is the neck.',
          'The metal bars across the neck are frets, and the little knobs at the top are tuning pegs.',
          'The thin metal strings run from the pegs over the frets to the bridge on the body.',
        ],
      },
      {
        title: 'Turning the pegs',
        illustration: 'tuning-pegs',
        paragraphs: [
          'Each peg tightens or loosens one string. Tighter makes the note higher, looser makes it lower.',
          'Turn slowly while you pluck the string, and watch the tuner.',
          'Always finish by tightening the string: start a little too low and come up until the tuner shows a tick.',
          'A guitar slips out of tune easily, so tune it every time you sit down.',
        ],
        mistakes: [
          'If a string goes too high, then loosen it a full turn first and come up to the note again.',
          'If a note will not settle, then pluck the string firmly and let it ring while you turn.',
        ],
      },
    ],
    drill: null,
    tool: 'tuner',
    play: { songId: 'open-strings-groove', level: 0, speed: 0.85, view: 'outline' },
    unlocks: [],
    done: 'Your guitar is in tune, and the same groove now sounds much better. Tune up at the start of every practice.',
  },
  {
    id: 'l03-first-frets',
    number: 3,
    title: 'First frets',
    subtitle: 'Press a string down and play the notes of a famous tune',
    minutes: 6,
    learn: [
      {
        title: 'Your fretting hand',
        illustration: 'fretting-hand',
        paragraphs: [
          'Put your thumb on the back of the neck, roughly behind your index and middle fingers.',
          'Press with the tip of a finger, just behind a fret bar and not on top of it.',
          'Your fingers are numbered: 1 is the index, 2 the middle, 3 the ring and 4 the little finger.',
        ],
        mistakes: ['If your hand feels tense, then lower your thumb a little and take a short break.'],
      },
      {
        title: 'Fret 1 on the 1st string',
        illustration: 'spot:5:1',
        paragraphs: [
          'Find the thinnest string, the 1st string, which is high E.',
          'Place finger 1 just behind the first fret bar on that string. This is fret 1.',
          'Pick the string and let it ring. You should hear a clear F note.',
          'Fret 2 is for finger 2 and fret 3 is for finger 3, in the same way.',
        ],
        mistakes: ['If it sounds dull, then move your fingertip closer to the fret bar.'],
      },
      {
        title: 'The 2nd string',
        illustration: 'spot:4:1',
        paragraphs: [
          'Your first tune also needs the string next to the thinnest one, the 2nd string.',
          'It works in the same way: fret 1 with finger 1, and fret 3 with finger 3.',
          'Look at the string you want before you pick it.',
        ],
        mistakes: ['If you pick the wrong string, then stop, look at the string you want, and pick again slowly.'],
      },
      {
        title: 'Fixing buzzing',
        paragraphs: [
          'A buzzing note means the string is touching a fret it should not.',
          'Press a little harder and move your fingertip close up behind the fret bar.',
          'Make sure the finger is not touching the string next to it.',
        ],
        mistakes: [
          'If it buzzes, then press closer to the fret bar.',
          'If it sounds muffled, then arch your finger so only the tip touches the string.',
          'If your fingertips hurt, then rest for a minute. They toughen up after a few days.',
        ],
      },
    ],
    drill: {
      skillId: 'basics.first-frets',
      generatorId: 'firstFrets',
      params: { string: 5, maxFret: 3, noteValue: 'half' },
      tempo: 50,
      rounds: 3,
      passAccuracy: 0.7,
      hint: 'Start on the thinnest string: open, then frets 1, 2 and 3, one finger for each fret. The second half moves to the 2nd string, with frets 1 and 3. Let every note ring.',
    },
    play: { songId: 'ode-to-joy', level: 0, speed: 0.75, view: 'outline' },
    unlocks: ['ode-to-joy'],
    done: 'You pressed strings down and played the main notes of the Ode to Joy. The whole tune is waiting in your songs. Fretting a string cleanly is the skill almost everything else builds on.',
  },
  {
    id: 'l04-crossing',
    number: 4,
    title: 'Crossing strings',
    subtitle: 'Aim your pick and move between strings',
    minutes: 6,
    learn: [
      {
        title: 'Aim the pick',
        illustration: 'strum-down',
        paragraphs: [
          'Rest the side of your picking hand lightly on the bridge, or float it just above the strings.',
          'Move the pick from your wrist and keep the motion small.',
          'Look at the string you are about to play, then move the pick straight to it.',
        ],
        mistakes: ['If you hit the wrong string, then slow down and look at the string before you play it.'],
      },
      {
        title: 'Remember the names',
        illustration: 'string-names',
        paragraphs: [
          'Tunes jump between neighbouring strings, so it helps to know them well.',
          'From the thickest, the 6th string, to the thinnest, the 1st, they are E, A, D, G, B and high E.',
          'When one string stops ringing, let it fade by touching it lightly, and move on to the next.',
        ],
        mistakes: ['If an old string keeps ringing under the new one, then lift your finger a little sooner.'],
      },
      {
        title: 'The 3rd string',
        illustration: 'spot:3:2',
        paragraphs: [
          'Your next tune, Twinkle Twinkle, moves between the three thinnest strings: the 3rd, the 2nd and the 1st.',
          'On the 3rd string there is one new place to learn: fret 2, pressed with finger 2.',
          'The rest you already know: the open strings, and frets 1 and 3 on the 2nd string.',
        ],
        mistakes: ['If you lose your place, then stop and find the 3rd string again: it is the third one counting from the thinnest.'],
      },
    ],
    drill: {
      skillId: 'fret.cross-string',
      generatorId: 'melody',
      params: { noteValue: 'half', bars: 8, key: 'C' },
      tempo: 50,
      rounds: 3,
      passAccuracy: 0.7,
      hint: 'Move between the three thinnest strings. First they are all open, then come a few pressed notes, and the last part is the start of Twinkle Twinkle. Look at each string before you pick it.',
    },
    play: { songId: 'twinkle-twinkle', level: 0, speed: 0.75, view: 'outline' },
    unlocks: ['twinkle-twinkle', 'happy-birthday', 'jingle-bells'],
    done: 'You moved between three strings and played the main notes of Twinkle Twinkle. Three more songs are open to you now: Twinkle Twinkle, Happy Birthday and Jingle Bells.',
  },
  {
    id: 'l05-em',
    number: 5,
    title: 'Your first chord: E minor',
    subtitle: 'Press two strings and strum them all',
    minutes: 6,
    learn: [
      {
        title: 'Read a chord box',
        illustration: 'chord:Em',
        paragraphs: [
          'A chord box is a picture of the neck. The thick line at the top is the nut, and the strings run downwards.',
          'The dots say where to press, and the numbers inside them tell you which finger to use.',
          `E minor needs two fingers. ${fingeringSentence('Em')}`,
          'All the other strings are played open.',
        ],
        mistakes: ['If you are unsure which string is which, then count from the thickest, the 6th, on the {left}.'],
      },
      {
        title: 'Strum slowly',
        illustration: 'strum-down',
        paragraphs: [
          'Brush the pick down across all six strings with a relaxed wrist.',
          'Go slowly and listen to each string in turn.',
          'Every string should ring out clearly with no buzzing or dull notes.',
        ],
        mistakes: [
          'If a string sounds dead, then check that your fingers are arched and not touching the strings next to them.',
          'If it buzzes, then press a little harder, just behind the fret bar.',
        ],
      },
    ],
    drill: {
      skillId: 'chord.open',
      generatorId: 'chordChanges',
      params: { chords: ['Em'] },
      tempo: 50,
      rounds: 3,
      passAccuracy: 0.7,
      hint: 'Hold E minor and strum all six strings each time the notes reach the line. The first strums are far apart, so you can check your fingers in between.',
    },
    play: { songId: 'em-groove', level: 0, speed: 0.85, view: 'chords' },
    unlocks: ['em-groove'],
    done: 'You played a whole chord and strummed it in time. One chord is enough to make real music.',
  },
  {
    id: 'l06-am',
    number: 6,
    title: 'Second chord and changing',
    subtitle: 'Learn A minor and switch between two chords',
    minutes: 6,
    learn: [
      {
        title: 'A minor',
        illustration: 'chord:Am',
        paragraphs: [
          `A minor uses three fingers. ${fingeringSentence('Am')}`,
          'Strum from the 5th string, the second thickest, and leave the 6th string alone.',
        ],
        mistakes: ['If the thickest string rings out, then aim your pick to start on the 5th string.'],
      },
      {
        title: 'Changing chords',
        illustration: 'chord:Em',
        paragraphs: [
          'Fingers 2 and 3 sit side by side in both chords. To go from E minor to A minor, move the pair one string towards the thinnest string, then add finger 1.',
          'Move the fingers together, as one shape, and not one after the other.',
          'Try a one-minute challenge. Switch back and forth as many times as you can, slowly and cleanly.',
          'It will feel clumsy at first, and that is normal. It gets quicker every day.',
        ],
        mistakes: [
          'If you stop to look for the next chord, then keep your strumming hand going and miss a strum instead.',
          'If the change is too slow, then practise the shapes without strumming first.',
        ],
      },
    ],
    drill: {
      skillId: 'chord.changes-open',
      generatorId: 'chordChanges',
      params: { chords: ['Em', 'Am'] },
      tempo: 50,
      rounds: 3,
      passAccuracy: 0.7,
      hint: 'You strum E minor four times, then A minor four times. After that you change after every two strums. Keep going even if a chord comes a little late.',
    },
    play: { songId: 'em-am-groove', level: 0, speed: 0.85, view: 'chords' },
    unlocks: ['em-am-groove'],
    done: 'You played two chords and changed between them in time. Most of the songs you know are built from just a few shapes like these.',
  },
  {
    id: 'l07-d-a',
    number: 7,
    title: 'D and A',
    subtitle: 'Two bright chords on the thinnest strings',
    minutes: 6,
    learn: [
      {
        title: 'The D chord',
        illustration: 'chord:D',
        paragraphs: [
          `D uses the three thinnest strings. ${fingeringSentence('D')}`,
          'The three fingers form a small triangle.',
          'Strum from the 4th string, which stays open, and skip the two thickest strings.',
        ],
        mistakes: ['If it sounds muffled, then keep your fingertips arched so they do not touch each other.'],
      },
      {
        title: 'The A chord',
        illustration: 'chord:A',
        paragraphs: [
          `A is three fingers in a row at fret 2. ${fingeringSentence('A')}`,
          'Strum from the 5th string and leave the thickest string alone.',
        ],
        mistakes: [
          'If the 1st string will not ring, then check that the finger on the 2nd string is not leaning on it.',
          'If the shape feels cramped, then try fingers 2, 3 and 4 in a row instead.',
        ],
      },
    ],
    drill: {
      skillId: 'chord.changes-open',
      generatorId: 'chordChanges',
      params: { chords: ['D', 'A'] },
      tempo: 50,
      rounds: 3,
      passAccuracy: 0.7,
      hint: 'You strum D four times, then A four times. After that you change after every two strums. D starts on the 4th string and A on the 5th.',
    },
    play: { songId: 'd-a-groove', level: 0, speed: 0.85, view: 'chords' },
    unlocks: ['d-a-groove'],
    done: 'You played D and A and changed between them in time. They are two of the most useful chords there are.',
  },
  {
    id: 'l08-g-c',
    number: 8,
    title: 'G and C, three-chord songs',
    subtitle: 'The big stretches, and songs with three chords',
    minutes: 7,
    learn: [
      {
        title: 'The G chord',
        illustration: 'chord:G',
        paragraphs: [
          `G is a big stretch. ${fingeringSentence('G')}`,
          'Spread your fingers wide and keep your thumb behind the neck.',
          'Strum all six strings.',
        ],
        mistakes: ['If your hand cramps, then stop and shake it out. The stretch gets easier over a few days.'],
      },
      {
        title: 'The C chord',
        illustration: 'chord:C',
        paragraphs: [
          fingeringSentence('C'),
          'Arch your fingers like little bridges so the open strings can ring.',
          'Strum from the 5th string and leave the thickest string alone.',
        ],
        mistakes: ['If the 3rd string is dull, then lift the base of your finger 2 away from it.'],
      },
      {
        title: 'The D7 chord',
        illustration: 'chord:D7',
        paragraphs: [
          'D7 is a close cousin of D with a slightly bluesy sound.',
          fingeringSentence('D7'),
          'Coming from G, finger 3 stays on the 1st string and only slides back one fret.',
          'Strum from the 4th string. It is a small, neat shape.',
        ],
        mistakes: ['If you mix up the shapes, then say each chord name out loud as you play it.'],
      },
    ],
    drill: {
      skillId: 'chord.changes-open',
      generatorId: 'chordChanges',
      params: { chords: ['G', 'C', 'D7'] },
      tempo: 50,
      rounds: 3,
      passAccuracy: 0.7,
      hint: 'These are the changes of your next song: from G to C and back, and from G to D7 and back. Each chord gets two strums, but D7 gets four. Keep going even if a chord comes a little late.',
    },
    play: { songId: 'saints', level: 0, speed: 0.85, view: 'chords' },
    unlocks: ['amazing-grace', 'saints', 'tom-dooley'],
    done: 'You strummed When the Saints with three chords. Three chords are enough for many real songs: Amazing Grace and Tom Dooley are open to you now as well.',
  },
  {
    id: 'l09-rhythm',
    number: 9,
    title: 'Rhythm',
    subtitle: 'Strum down and up, and keep the beat',
    minutes: 6,
    learn: [
      {
        title: 'Down and up',
        illustration: 'strum-down',
        paragraphs: [
          'Keep your strumming hand swinging down and up like a pendulum, all the time.',
          'Strum down on the beats and up in between, even when you do not touch the strings.',
          'Keep your wrist loose. The movement comes from the wrist and a little from the forearm.',
          'On the way up the pick only catches the three thinnest strings. That is how it should sound.',
        ],
        mistakes: ['If your arm gets tired, then relax your shoulder and make the swing smaller.'],
      },
      {
        title: 'Counting the beat',
        paragraphs: [
          'Count out loud: 1 and 2 and 3 and 4 and.',
          'Your hand goes down on the numbers and up on the “and”.',
          'Tap your foot on the numbers to keep yourself steady.',
          'Start slowly. Smooth and steady is better than fast and uneven.',
        ],
        mistakes: [
          'If you keep losing the beat, then count out loud and play more slowly.',
          'If you stop to change chord, then keep the hand moving and let a strum be quiet.',
        ],
      },
    ],
    drill: {
      skillId: 'chord.strum-patterns',
      generatorId: 'strumPattern',
      params: { chord: 'Em', pattern: 'D-DUD-DU', bars: 8 },
      tempo: 60,
      rounds: 3,
      passAccuracy: 0.7,
      hint: 'Hold E minor. Strum down on every count: 1, 2, 3, 4. After a little while an up strum comes in after 2 and after 4: down, down-up, down, down-up.',
    },
    play: { songId: 'tom-dooley', level: 0, speed: 0.85, view: 'whole' },
    unlocks: [],
    done: 'You kept a strum going on every beat of Tom Dooley. Rhythm is what makes a song sound like itself.',
  },
  {
    id: 'l10-riff',
    number: 10,
    title: 'Your first riff',
    subtitle: 'A short, catchy pattern on the two thickest strings',
    minutes: 6,
    learn: [
      {
        title: 'A riff on the low strings',
        illustration: 'spot:0:3',
        paragraphs: [
          'A riff is a short, catchy pattern of notes that repeats.',
          'This one lives on the two thickest strings. On the 6th string you play it open, then fret 3 with finger 1, then fret 5 with finger 3.',
          'Slide your hand a little way up the neck so that finger 1 sits at fret 3. Finger 3 then reaches fret 5 without a stretch.',
          'Keep your picking steady and let each note ring until the next one.',
        ],
        mistakes: ['If the notes run together, then lift your finger just before the next pick.'],
      },
      {
        title: 'The next string',
        illustration: 'spot:1:3',
        paragraphs: [
          'Halfway through it moves to the 5th string and plays the same three places there: open, fret 3 with finger 1, and fret 5 with finger 3.',
          'Look at the string before you pick it, and keep your hand relaxed.',
          'Play it slowly first, then add speed a little at a time.',
        ],
        mistakes: ['If it feels rushed, then slow down. A slow riff played cleanly always sounds better.'],
      },
    ],
    drill: {
      skillId: 'fret.single-string',
      generatorId: 'firstFrets',
      params: { string: 0, maxFret: 3, noteValue: 'quarter' },
      tempo: 60,
      rounds: 3,
      passAccuracy: 0.7,
      hint: 'First walk through the three places on each string: open, fret 3, fret 5. Then comes the riff itself: two quick open notes and a pressed one, over and over.',
    },
    // The song's own finger numbers assume the hand stays at the first frets; the lesson teaches the riff two frets higher.
    play: { songId: 'first-riff', level: 0, speed: 0.85, view: 'whole', fingers: { 3: 1, 5: 3 } },
    unlocks: ['first-riff'],
    done: 'You played a whole riff, and you finished First steps! Next come daily sessions, short practices planned for you that build on everything you have learned.',
  },
]

/**
 * The course a lesson is part of: the singing course for one of its lessons, the guitar course for any
 * other id. (By the lists themselves, not through src/training/instruments.ts, which imports this file.)
 */
export function courseOfLesson(id: string): Lesson[] {
  return VOICE_COURSE.some((l) => l.id === id) ? VOICE_COURSE : COURSE
}

// The helpers below take the course to look in. Where a lesson id is given, the default is the course
// that lesson belongs to. Where only progress rows are given, the default is the guitar course, as it
// always was: the lesson table holds the rows of both courses, and rows alone do not say which is meant.

/** A lesson by its id, of either course; of `course` alone when one is given. */
export function lessonById(id: string, course?: Lesson[]): Lesson | undefined {
  if (course) return course.find((l) => l.id === id)
  return COURSE.find((l) => l.id === id) ?? VOICE_COURSE.find((l) => l.id === id)
}

/** The lesson after this one in its own course; undefined after the last. One course never runs on into the other. */
export function nextLessonAfter(id: string, course: Lesson[] = courseOfLesson(id)): Lesson | undefined {
  const i = course.findIndex((l) => l.id === id)
  return i >= 0 ? course[i + 1] : undefined
}

/** Built-in song ids unlocked by the lessons of `course` marked done. */
export function unlockedSongIds(progress: LessonProgress[], course: Lesson[] = COURSE): string[] {
  const done = new Set(progress.filter((p) => p.status === 'done').map((p) => p.id))
  const ids: string[] = []
  for (const lesson of course) {
    if (!done.has(lesson.id)) continue
    for (const id of lesson.unlocks) if (!ids.includes(id)) ids.push(id)
  }
  return ids
}

/** The lesson of `course` to do next: the one that is open. An open lesson of the other course is not it. */
export function nextAvailableLesson(progress: LessonProgress[], course: Lesson[] = COURSE): Lesson | undefined {
  const byId = new Map(progress.map((p) => [p.id, p]))
  return course.find((l) => byId.get(l.id)?.status === 'available')
}

/**
 * The tool a lesson runs as its middle step, where another lesson has its practice round: the tuner,
 * the range finder, or "meet the note". A lesson with a practice round runs none.
 */
export function lessonTool(lesson: Pick<Lesson, 'drill' | 'tool'>): NonNullable<Lesson['tool']> | undefined {
  return lesson.drill ? undefined : lesson.tool
}

/** What the song step of a lesson is called: a guitar song is played, a song of the singing course is sung. */
export function songStepLabel(lesson: Pick<Lesson, 'id'>): 'Play' | 'Sing' {
  return courseOfLesson(lesson.id) === VOICE_COURSE ? 'Sing' : 'Play'
}

/** The plays handed out for the last singing lesson, by the lesson's own play and then by song. See `lessonPlayFor`. */
const goalPlays = new WeakMap<LessonPlay, Map<string, LessonPlay>>()

/**
 * The song a lesson puts on the screen for this learner. It is the lesson's own, except in the last
 * singing lesson, which sings the goal the singer picked in set-up (`goalSongId` of the singing
 * profile). A goal that is missing, or is not one of the songs the course can end on, leaves the
 * lesson its own song. Null for a lesson without a song.
 *
 * The play of the last singing lesson is made here, and two things are kept true of it:
 * - asked again for the same lesson and song, it is the very same object. A screen asks on every draw,
 *   and a new object each time would look like a new song to whatever watches the play;
 * - it cannot be written to, so nothing a screen does with it reaches the next singer, or the course.
 */
export function lessonPlayFor(lesson: Pick<Lesson, 'id' | 'play'>, goalSongId?: string): LessonPlay | null {
  const own = lesson.play
  if (!own || lesson.id !== VOICE_GOAL_LESSON_ID) return own
  const songId = goalSongId !== undefined && VOICE_GOAL_SONG_IDS.includes(goalSongId) ? goalSongId : own.songId
  const bySong = goalPlays.get(own) ?? new Map<string, LessonPlay>()
  goalPlays.set(own, bySong)
  const play = bySong.get(songId) ?? Object.freeze({ ...own, songId })
  bySong.set(songId, play)
  return play
}
