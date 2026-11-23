import type { Lesson } from './types'

/** The lesson that sings the singer's own goal song. */
export const VOICE_GOAL_LESSON_ID = 'v10-song'

/**
 * The songs a singer can pick as their goal in set-up: the course songs that fit every range the app
 * stores (eight notes from the lowest to the highest), each met in an earlier lesson. The last lesson
 * sings the one picked.
 */
export const VOICE_GOAL_SONG_IDS: readonly string[] = ['sing-ode-to-joy', 'sing-saints', 'sing-mary-lamb']

/** The song the last lesson sings for a singer who picked none. */
export const VOICE_DEFAULT_GOAL_SONG_ID = 'sing-ode-to-joy'

/**
 * First steps for singing, in order. The same lesson shape as the guitar course, written for someone
 * who has never sung on purpose and may feel shy about it: plain words, short sentences, and in the
 * first lesson the three things such a learner needs to hear before a note is sung (nobody is
 * listening, cracks and wobbles are normal, singing should never hurt).
 *
 * How the lessons are put together:
 * - the first two run a tool where the others have a practice round (`tool`: the range finder, then
 *   "meet the note"). Nothing in a tool is scored;
 * - a practice round is the skill's own exercise, built by its generator for the singer's range
 *   (src/lessons/material.ts), so the lesson and the daily plan sing the same thing. A drill names the
 *   pace, and the step for a skill that climbs a ladder; what is sung is in the skill itself;
 * - a song is never slowed down and never thinned out: `speed` is 1 and `view` is 'outline' in every
 *   lesson, and `level` is the song level (0 = echo each line, 1 = echo two lines, 2 = the whole tune
 *   with its words);
 * - every "If … then …" is also shown as a tip after a round that went less well, so each one names
 *   something the singer can do on the next try.
 *
 * Words to keep away from: anything that asks for more voice, anything that blames, any number a
 * beginner cannot use. When the app cannot hear, the phone moves closer; the singer is never asked for
 * more. A card with a drawing uses the words drawn in it. voiceCourse.test.ts holds the text to all of this.
 *
 * The trap for imports: this file must not import from src/songs. The song list imports the courses
 * (through src/training/instruments.ts), so that would close a circle.
 */
export const VOICE_COURSE: Lesson[] = [
  {
    id: 'v01-voice',
    number: 1,
    title: 'Meet your voice',
    subtitle: 'Find the notes that feel easy for you',
    minutes: 5,
    learn: [
      {
        title: 'Singing is speaking, held longer',
        illustration: 'voice-posture',
        paragraphs: [
          'You use your voice all day. Singing is the same voice, with each sound held a little longer.',
          'Nobody is listening. The app only looks at how high or low your note is, and it keeps no sound.',
          'Stand tall, with your feet apart and your shoulders loose, as in the picture, or sit upright.',
          'Every voice cracks and wobbles at first. That is normal, and it is how a voice finds its way.',
        ],
        mistakes: [
          'If you feel shy, then start with a quiet hum behind closed lips. That counts as singing.',
          'If your shoulders creep up, then let them drop and shake your arms loose.',
        ],
      },
      {
        title: 'You and your phone',
        illustration: 'voice-phone',
        paragraphs: [
          'Stand your phone up about a forearm away from you, with its screen facing you.',
          'A quiet room helps the app hear you, so turn off music and the TV.',
          'Sing about as strongly as you speak. That is all the app needs.',
          'With headphones on, the app can sing along with you. Without them it sings only in the gaps, and that is enough.',
        ],
        mistakes: ['If the app cannot hear you, then move the phone a little closer and keep your voice as it is.'],
      },
      {
        title: 'It should never hurt',
        paragraphs: [
          'Singing should never hurt. It should feel about as easy as talking to a friend.',
          'If your throat feels sore, scratchy or tired, stop for today.',
          'Keep some water nearby. The app is a practice helper, not a voice doctor.',
          'Next the app finds your easy notes: you hum, then slide your voice down and up. Stop while it is easy, because it is not a test of how high you can go.',
        ],
        mistakes: [
          'If a note feels tight, then stop there and stay with the notes that feel easy.',
          'If you feel dizzy, then stop and breathe normally for a while.',
        ],
      },
    ],
    drill: null,
    tool: 'range',
    play: null,
    unlocks: [],
    done: 'You met your voice, and the app knows which notes are easy for you. Everything it asks you to sing stays among those notes.',
  },
  {
    id: 'v02-meet',
    number: 2,
    title: 'Meet the note',
    subtitle: 'Hear a note and find it with your voice',
    minutes: 4,
    learn: [
      {
        title: 'Listen, hear it inside, then sing',
        paragraphs: [
          'To sing a note you first have to hear it. So every exercise starts with listening.',
          'Let the note finish, then hear it again inside your head, the way you can hear a doorbell after it has rung.',
          'Only then sing it, on an easy "la" or "ah".',
        ],
        mistakes: ['If you start singing while the note still sounds, then wait for it to end. Listening and singing at once is much harder.'],
      },
      {
        title: 'Under or over the note',
        illustration: 'pitch-ladder',
        paragraphs: [
          'Think of notes as rungs of a ladder: higher notes sit further up, lower notes further down.',
          'In the picture the thick rung is the note, and the dot just under it is your voice.',
          'On the screen the note is a bar. Slide your voice up a little when your dot is under the bar, and down a little when it is over.',
          'The shaded band marks your easy notes. Nothing you are asked to sing lies outside it.',
        ],
        mistakes: ['If you cannot tell whether you are under or over, then slide your voice slowly up and down and watch which way the dot moves.'],
      },
      {
        title: 'High voice, low voice, same note',
        paragraphs: [
          'Some voices are deep and some are high, and both can sing the same tune.',
          'A deep voice may sing a note lower than the app does, and a high voice higher. That is called an octave apart, and it counts just the same.',
          'So sing where your voice feels at home. Your dot still lands on the bar.',
          'Next you hear three notes, one at a time, and slide your voice until your dot meets the bar. Nothing is scored.',
        ],
        mistakes: ['If a note feels too high or too low to reach, then sing it in the part of your voice that feels easy.'],
      },
    ],
    drill: null,
    tool: 'match',
    play: null,
    unlocks: [],
    done: 'You listened first and then looked for the note with your voice. Every song is made of that one move.',
  },
  {
    id: 'v03-match',
    number: 3,
    title: 'Match a note',
    subtitle: 'Sing a note back and hold it',
    minutes: 5,
    learn: [
      {
        title: 'Reading the screen',
        illustration: 'voice-lanes',
        paragraphs: [
          'Each note is a bar. The bars move from right to left towards the line.',
          'Higher bars are higher notes, and longer bars are longer notes.',
          'The dot on the line is your voice. Sing when a bar reaches the line, and keep singing until it has passed.',
          'While your dot sits on a bar, the bar fills in.',
        ],
        mistakes: ['If your dot sits under the bar, then think a little higher.', 'If your dot sits over the bar, then sing softer and let the note settle.'],
      },
      {
        title: 'My turn, your turn',
        paragraphs: [
          'First the app sings a note. That is its turn, so you only listen.',
          'Then the same note comes to the line for you. Sing it back on "la" and hold it until the bar has passed.',
          'A click keeps time while you sing, like a foot tapping.',
        ],
        mistakes: [
          'If you come in a little late, then keep singing. A note that starts late still counts.',
          'If you sing along during the app’s turn, then wait instead, because its turn is for listening.',
        ],
      },
      {
        title: 'Breathe in the gap',
        paragraphs: [
          'After each note you sing, there is a gap while the app sings the next one.',
          'Use that gap to breathe in, quietly and without hurry.',
          'Your first song works the same way: the app sings a line of Hot Cross Buns, and you sing it back on "la".',
        ],
        mistakes: ['If you run out of air before a bar ends, then start the note a little softer next time.'],
      },
    ],
    drill: {
      skillId: 'voice.pitch.match',
      generatorId: 'voiceEcho',
      params: { step: 0 },
      tempo: 60,
      rounds: 3,
      passAccuracy: 0.7,
      hint: 'The app sings a note, then you sing it back on "la" and hold it until the bar has passed. There are four notes, all close to your easiest one. Breathe while the app sings.',
    },
    play: { songId: 'sing-hot-cross-buns', level: 0, speed: 1, view: 'outline' },
    unlocks: [],
    done: 'You sang notes back and echoed Hot Cross Buns one line at a time. Matching a note is what every song is built on.',
  },
  {
    id: 'v04-steps',
    number: 4,
    title: 'Step up, step down',
    subtitle: 'Three next-door notes, up and back',
    minutes: 5,
    learn: [
      {
        title: 'Next-door notes: 1, 2, 3',
        paragraphs: [
          'Most tunes move in small steps, from one note to the note next door.',
          'The bars now carry numbers. Note 1 is home, note 2 is one step up, and note 3 is one step above that.',
          'You sing 1, 2, 3, 2, 1: up two steps and back home, like going up a couple of stairs and coming down again.',
          'Sing the numbers or "la", whichever feels easier.',
        ],
        mistakes: [
          'If two notes come out the same, then make the step a little bigger than feels natural.',
          'If you lose your place, then listen to the app sing it again and join in on your next turn.',
        ],
      },
      {
        title: 'Keep the air going on the way down',
        paragraphs: [
          'On the way up, most people take care. On the way down the voice likes to relax too early, and the notes sink.',
          'So keep your breath flowing just the same on the way down.',
          'Step down the stairs one at a time. Do not slide down the rail.',
          'Hot Cross Buns is made of these same three notes, coming down: 3, 2, 1.',
        ],
        mistakes: ['If the notes sink on the way down, then keep the air moving and think each note a little higher.'],
      },
    ],
    drill: {
      skillId: 'voice.pitch.steps',
      generatorId: 'voicePattern',
      tempo: 60,
      rounds: 3,
      passAccuracy: 0.7,
      hint: 'The app sings 1, 2, 3, 2, 1 and you sing it back. Then the same again, a little higher where your easy notes have room. Keep the air moving on the way down.',
    },
    play: { songId: 'sing-hot-cross-buns', level: 1, speed: 1, view: 'outline' },
    unlocks: ['sing-hot-cross-buns'],
    done: 'You stepped up and down three notes and echoed Hot Cross Buns two lines at a time. The song is in your songs now.',
  },
  {
    id: 'v05-words',
    number: 5,
    title: 'Sing the words',
    subtitle: 'Put words on the notes you know',
    minutes: 5,
    learn: [
      {
        title: 'The open sound carries the note',
        illustration: 'voice-mouth',
        paragraphs: [
          'A hum on "mm" keeps the mouth closed. On "ah" the mouth is open and relaxed, and the note rings out.',
          'Words work the same way. The note lives on the open sound in the middle: the "o" in "hot", the "u" in "buns".',
          'Stay on that open sound for the whole bar, and add the last letter right at the end.',
        ],
        mistakes: [
          'If a word comes out squeezed, then let your jaw drop a little, as for "ah".',
          'If a note stops early, then you closed the word too soon, so hold the open sound longer.',
        ],
      },
      {
        title: 'Breathe at the marks',
        paragraphs: [
          'A song is made of lines, and each line is sung on one breath.',
          'A small mark on the screen shows where a line ends. That is your place to breathe.',
          'Take a quick, quiet breath there, even when you still have air left.',
        ],
        mistakes: ['If you run out of air in the middle of a line, then breathe at every mark, also when you do not feel the need.'],
      },
      {
        title: 'Every line has its starting note',
        paragraphs: [
          'Now the app gives you just one note to start on, and you sing the whole song with its words.',
          'Each line has its own first note. Look where its first bar sits: higher, lower, or where you just were.',
          'In Hot Cross Buns the first two lines start on the same note, and the last line starts on the note you have just ended on.',
          'First, a warm-up for your ear: a tune of three notes to sing back from memory.',
        ],
        mistakes: ['If you start on another note than the one you heard, then listen to the starting note again and hum it before you sing.'],
      },
    ],
    drill: {
      skillId: 'voice.pitch.echo',
      generatorId: 'voiceEcho',
      params: { step: 0 },
      tempo: 72,
      rounds: 3,
      passAccuracy: 0.7,
      hint: 'Listen to the little tune of three notes, then sing it back on "la". This time your notes stay hidden until you have sung them, so let your ear lead.',
    },
    play: { songId: 'sing-hot-cross-buns', level: 2, speed: 1, view: 'outline' },
    unlocks: ['sing-mary-lamb'],
    done: 'You sang Hot Cross Buns with its words, from one starting note to the end. Mary Had a Little Lamb is waiting in your songs.',
  },
  {
    id: 'v06-five',
    number: 6,
    title: 'Five notes',
    subtitle: 'Up five notes and back on one breath',
    minutes: 5,
    learn: [
      {
        title: 'Up five and back',
        paragraphs: [
          'Five next-door notes in a row, 1 2 3 4 5, and back down to 1. Singers everywhere warm up with this.',
          'The notes are quicker now: two for every click.',
          'Take one quiet breath before you start. It lasts the whole way up and back.',
        ],
        mistakes: [
          'If you run out of air before the end, then sing a little softer so the breath lasts.',
          'If the quick notes blur together, then give each one its own little "la".',
        ],
      },
      {
        title: 'Lighter at the top',
        paragraphs: [
          'As a tune climbs, it is tempting to give the top note more force. It needs less.',
          'Let the top note be small and light, like setting a cup down gently.',
          'Keep your shoulders loose and your jaw soft all the way up.',
        ],
        mistakes: ['If the top note feels tight, then sing it smaller and softer.', 'If the top note lands under its bar, then think of setting it down from above.'],
      },
      {
        title: 'A little higher, then back down',
        paragraphs: [
          'In each round you sing the five notes twice. The second time may start one small step higher.',
          'This happens only where your easy notes have room. The app never goes past them.',
          'The next round starts back where the first one did.',
          'Your song is Mary Had a Little Lamb. The app sings a line, and you sing it back on "la".',
        ],
        mistakes: ['If it starts to feel high, then keep the notes small and easy, and stop if it feels tight.'],
      },
    ],
    drill: {
      skillId: 'voice.pitch.five-note',
      generatorId: 'voicePattern',
      tempo: 60,
      rounds: 3,
      passAccuracy: 0.7,
      hint: 'The app sings five notes up and back down, then it is your turn. Sing them on one breath, and let the top note be light.',
    },
    play: { songId: 'sing-mary-lamb', level: 0, speed: 1, view: 'outline' },
    unlocks: ['sing-ode-to-joy'],
    done: 'You sang five notes up and back on one breath, and echoed Mary Had a Little Lamb line by line. Ode to Joy is open to you now.',
  },
  {
    id: 'v07-hold',
    number: 7,
    title: 'Hold it steady',
    subtitle: 'Hold one note on a calm breath',
    minutes: 5,
    learn: [
      {
        title: 'Breathe low and quiet',
        illustration: 'voice-breath',
        paragraphs: [
          'Put a hand on your belly. On the breath in, your low ribs and belly widen, and your shoulders stay still.',
          'It is the breath you take when you are relaxed, or just before a yawn.',
          'Let it be quiet. A noisy gasp means the air is rushing in too fast.',
        ],
        mistakes: ['If your shoulders rise as you breathe in, then breathe out all the way first and let the next breath drop in low.'],
      },
      {
        title: 'Steady air, not more air',
        paragraphs: [
          'A long note needs an even stream of air, like blowing gently on hot soup.',
          'More air does not make a note steadier. It tends to make it shake.',
          'Watch your dot: when it stays on the bar right to the end, your air was steady.',
          'A small wobble is normal. Every voice has one.',
        ],
        mistakes: [
          'If the note sinks towards its end, then save a little air for it and think slightly higher as you finish.',
          'If the note shakes, then use less air and let your jaw hang loose.',
        ],
      },
      {
        title: 'Feeling dizzy? Stop and breathe',
        paragraphs: [
          'Long notes use more breath than you might expect. After each one, breathe normally while the app sings.',
          'If you feel dizzy or light-headed, stop and sit down for a moment. Carry on only when it has passed.',
          'Your song, Mary Had a Little Lamb, ends on its longest note, the word "snow". Hold it calmly until its bar has passed.',
        ],
        mistakes: ['If you feel dizzy, then stop and breathe normally until it has passed.'],
      },
    ],
    drill: {
      skillId: 'voice.pitch.hold',
      generatorId: 'voiceHold',
      params: { step: 0 },
      tempo: 60,
      rounds: 3,
      passAccuracy: 0.7,
      hint: 'The app sings a note, then you hold it for four clicks on one calm breath. Use steady air, not more air, and rest while the app sings the next note.',
    },
    play: { songId: 'sing-mary-lamb', level: 2, speed: 1, view: 'outline' },
    unlocks: ['sing-aunt-rhody'],
    done: 'You held notes steady on a calm breath and sang Mary Had a Little Lamb with its words. Go Tell Aunt Rhody is open to you now.',
  },
  {
    id: 'v08-jumps',
    number: 8,
    title: 'Small jumps',
    subtitle: 'Skip over a note and land on the next',
    minutes: 5,
    learn: [
      {
        title: 'Skipping a note',
        paragraphs: [
          'So far every note was next door to the last. Now you skip one: from 1 straight to 3, and from 3 to 5.',
          'You have sung all three of these notes before. Only the way between them is new.',
          'This time the app sings just the first note. The rest you read from the numbers on the bars.',
        ],
        mistakes: ['If you land on the note in between, then make the jump a little bigger than feels natural.'],
      },
      {
        title: 'Hear the landing note first',
        paragraphs: [
          'Before you jump, hear the note you are going to inside your head.',
          'It helps to sing the steps in your mind first: 1, 2, 3. Then leave out the 2.',
          'Keep the jumps light. A jump needs no extra force.',
        ],
        mistakes: ['If you cannot find note 5, then hum up the steps 1, 2, 3, 4, 5 first and jump after that.'],
      },
      {
        title: 'Land on it, without sliding',
        paragraphs: [
          'A jump lands right on its note, like stepping onto a stone.',
          'Sliding up to a note from below is a common habit. Starting each note with a soft "la" helps you land on it.',
          'Your song, Ode to Joy, moves in steps all the way. The jumps are for the song that opens after this lesson, When the Saints.',
        ],
        mistakes: ['If you slide up to a note, then hear it first and start right on it.'],
      },
    ],
    drill: {
      skillId: 'voice.interval.thirds',
      generatorId: 'voicePattern',
      tempo: 56,
      rounds: 3,
      passAccuracy: 0.7,
      hint: 'You hear only the first note. Then sing 1, 3, 5, 3, 1 from the bars, quick and light, and land right on each note.',
    },
    play: { songId: 'sing-ode-to-joy', level: 1, speed: 1, view: 'outline' },
    unlocks: ['sing-saints', 'sing-london-bridge'],
    done: 'You jumped over notes and landed on them, and echoed Ode to Joy two lines at a time. When the Saints is open to you now.',
  },
  {
    id: 'v09-slides',
    number: 9,
    title: 'Sliding higher, staying easy',
    subtitle: 'Slide up and down like a quiet siren',
    minutes: 5,
    learn: [
      {
        title: 'The slide',
        illustration: 'voice-slide',
        paragraphs: [
          'A slide is one smooth line of sound: from a low note up to a high note and back down, like a quiet siren.',
          'Slide on a soft "oo". There are no steps on the way, just one unbroken line.',
          'Only three places are checked: where you start, the top, and where you land. The way between them is yours.',
        ],
        mistakes: ['If the slide comes out in steps, then think of a siren and let the sound glide.'],
      },
      {
        title: 'Cracks are normal',
        paragraphs: [
          'On the way up your voice may crack, or flip into a lighter sound. Every voice does that.',
          'A crack only shows where your voice changes gear. The app does not count it against you.',
          'Keep the slide quiet. Quiet slides are the gentle ones.',
        ],
        mistakes: ['If your voice cracks, then smile and slide again. Nothing is lost.'],
      },
      {
        title: 'Stop while it is easy',
        paragraphs: [
          'The second slide starts a little higher than the first where your easy notes have room, and never beyond them.',
          'This is not a test of how high you can go. Stop while it still feels easy.',
          'After the slides the app asks how they felt: easy, OK or tight. If you say tight, it stays a little lower from then on where it can.',
        ],
        mistakes: ['If your throat tightens near the top, then end the slide there. A lower top is fine.'],
      },
    ],
    drill: {
      skillId: 'voice.range.slides',
      generatorId: 'voiceSlide',
      params: { step: 0 },
      tempo: 60,
      rounds: 3,
      passAccuracy: 0.7,
      hint: 'Listen, then slide up from the first note to the top note and back down on a soft "oo", like a quiet siren. Stop while it feels easy.',
    },
    play: { songId: 'sing-saints', level: 1, speed: 1, view: 'outline' },
    unlocks: ['sing-jingle-bells', 'sing-twinkle'],
    done: 'You slid your voice up and down and stayed with what felt easy, and you echoed When the Saints. Jingle Bells is open to you now.',
  },
  {
    id: VOICE_GOAL_LESSON_ID,
    number: 10,
    title: 'Your first whole song',
    subtitle: 'One starting note, then the song is yours',
    minutes: 6,
    learn: [
      {
        title: 'One note to start, then it is yours',
        paragraphs: [
          'Today you sing a whole song with its words, from the first line to the last.',
          'The app gives you one starting note. After that you hear only the click, and you carry the tune yourself.',
          'You have every piece you need: steps, small jumps, long notes and a breath at each mark.',
        ],
        mistakes: [
          'If you lose the tune half way, then keep going with the words and join the notes again at the next line.',
          'If the first line wanders off, then stop, listen to the starting note once more and begin again.',
        ],
      },
      {
        title: 'Headphones let you hear the guitar',
        paragraphs: [
          'On the phone speaker the app only clicks while you sing, so the microphone hears you and not the app.',
          'With headphones on, the guide can play along: a guitar strums the chords and a voice sings your notes with you. The speaker icon turns it on and off.',
          'Both ways are real singing. Use whichever feels better today.',
        ],
        mistakes: ['If the app says the microphone is hearing the speaker, then put headphones on or turn the guide off.'],
      },
      {
        title: 'What daily practice looks like',
        paragraphs: [
          'After this lesson the app plans a short session for you each day: a gentle warm-up, an exercise or two, and a song.',
          'It carries on from these lessons and adds new things a little at a time.',
          'A few minutes on most days is plenty. Little and often suits a voice well.',
          'On a day when your voice feels tired, tell the app on the Today page and rest.',
        ],
        mistakes: ['If a session feels like too much, then stop early. A short day is still a day of practice.'],
      },
    ],
    drill: {
      skillId: 'voice.pitch.match',
      generatorId: 'voiceEcho',
      params: { step: 1 },
      tempo: 60,
      rounds: 3,
      passAccuracy: 0.7,
      hint: 'A warm-up before your song: the app sings a note, and you sing it back and hold it. The notes lie a little further apart than in lesson 3.',
    },
    // The song a singer who picked no goal ends on. `lessonPlayFor` (course.ts) puts the singer's own goal in its place.
    play: { songId: VOICE_DEFAULT_GOAL_SONG_ID, level: 2, speed: 1, view: 'outline' },
    unlocks: [],
    done: 'You sang a whole song from one starting note, and you finished First steps! Next come daily sessions: short practices planned for you that build on everything you have learned.',
  },
]
