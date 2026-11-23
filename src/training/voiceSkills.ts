/**
 * The twelve singing skills (docs/SINGING.md §6). They live beside the guitar list, never inside it:
 * `SKILLS` keeps meaning guitar, and `skillsFor('voice')` (instruments.ts) hands out these.
 *
 * Two kinds of skill:
 * - a tempo skill gets faster as it is learned, like every guitar skill, but never slower than its
 *   floor (`minTempo`): sung too slowly, a line outlasts the breath;
 * - a step skill is sung at one tempo for good (ref = start = target = floor), because slower is not
 *   easier for a held note, a slide or a longer line. Its content gets harder instead, step by step
 *   (`steps`), and the Coach climbs that ladder where it would raise a tempo.
 *
 * What a step asks for is in its `params`; the generators (src/training/exercises/voice) read them and
 * nothing else does. `band` is how many cents either side of a note still count as in tune. A step
 * that needs more room than the smallest range the app stores (7 semitones) says so in `span`, and a
 * ladder never gets narrower on the way up: it is climbed one step at a time, so a narrow step above a
 * wide one could not be reached by a small voice.
 *
 * Notes are named by number, as the pitch lanes show them: 1 is the home note of the exercise, 8 the
 * same note an octave up.
 */
import type { SkillDef, SkillStep } from './types'

type Common = Pick<SkillDef, 'id' | 'name' | 'category' | 'tier' | 'prerequisites' | 'description' | 'tips' | 'generators'>

/** A skill that speeds up: `pace` is the reference tempo, where it starts, where it aims, and its floor. */
function paced(skill: Common, pace: [ref: number, start: number, target: number, min: number]): SkillDef {
  const [refTempo, startTempo, targetTempo, minTempo] = pace
  return { ...skill, refTempo, startTempo, targetTempo, minTempo }
}

/** A skill sung at one tempo that climbs a ladder of steps instead. */
function stepped(skill: Common, tempo: number, steps: SkillStep[]): SkillDef {
  return { ...skill, refTempo: tempo, startTempo: tempo, targetTempo: tempo, minTempo: tempo, steps }
}

export const VOICE_SKILLS: SkillDef[] = [
  // Tier 0: the one skill everything else is built on.
  stepped(
    {
      id: 'voice.pitch.match',
      name: 'Match a note',
      category: 'pitch',
      tier: 0,
      prerequisites: [],
      description: 'Listen to one note, then sing it back and hold it. Singing in tune starts here.',
      tips: [
        'Listen to the whole note first and hear it in your head before you sing.',
        'Sing on "la" or "ah", about as strong as your speaking voice.',
        'If your dot sits under the bar, think a little higher. If it sits over the bar, let the note settle.',
      ],
      generators: ['voiceEcho'],
    },
    60,
    [
      { label: 'close notes', params: { form: 'note', pool: 'close', band: 80 }, bonus: 0 },
      { label: 'wider notes', params: { form: 'note', pool: 'wider', band: 65 }, bonus: 12 },
      { label: 'all your easy notes', params: { form: 'note', pool: 'range', band: 50 }, bonus: 20 },
      { label: 'after a short note', params: { form: 'note', pool: 'range', cueBeats: 1, band: 35 }, bonus: 28 },
    ],
  ),

  // Tier 1: moving from note to note, holding one, sliding, and remembering a tune.
  paced(
    {
      id: 'voice.pitch.steps',
      name: 'Step up and down',
      category: 'pitch',
      tier: 1,
      prerequisites: ['voice.pitch.match'],
      description: 'Sing three next-door notes up and back down: 1, 2, 3, 2, 1.',
      tips: [
        'Each note is one small step from the last, like walking up three stairs.',
        'Keep the air moving on the way down. That is where notes tend to sink.',
        'Sing the numbers or "la", whichever feels easier.',
      ],
      generators: ['voicePattern'],
    },
    [66, 60, 88, 54],
  ),
  paced(
    {
      id: 'voice.pitch.five-note',
      name: 'Five notes up and back',
      category: 'pitch',
      tier: 1,
      prerequisites: ['voice.pitch.steps'],
      description: 'Sing five notes up and back down in one go, then again a little higher.',
      tips: [
        'Take a quiet breath before you start. One breath lasts the whole way.',
        'Let the top note be light. It does not need more air.',
        'When it starts to feel high, keep the note small and easy.',
      ],
      generators: ['voicePattern'],
    },
    [66, 60, 96, 54],
  ),
  stepped(
    {
      id: 'voice.pitch.hold',
      name: 'Hold a note steady',
      category: 'breath',
      tier: 1,
      prerequisites: ['voice.pitch.match'],
      description: 'Hold one note in tune from its start to its end, on one calm breath.',
      tips: [
        'Breathe in low and quiet. Your shoulders stay still.',
        'Use steady air, not more air.',
        'If you feel dizzy, stop and breathe normally for a while.',
      ],
      generators: ['voiceHold'],
    },
    60,
    [
      { label: '4 beats', params: { beats: 4, band: 65 }, bonus: 0 },
      { label: '6 beats', params: { beats: 6, band: 50 }, bonus: 8 },
      { label: '8 beats', params: { beats: 8, band: 50 }, bonus: 16 },
      { label: '8 beats, right on the note', params: { beats: 8, band: 35 }, bonus: 24 },
    ],
  ),
  stepped(
    {
      id: 'voice.range.slides',
      name: 'Slides',
      category: 'range',
      tier: 1,
      prerequisites: ['voice.pitch.match'],
      description: 'Slide your voice up from an easy note and back down again, like a small siren.',
      tips: [
        'Slide on "oo", quietly. Quiet slides are the kind ones.',
        'A crack on the way is normal and does no harm.',
        'Stop while it still feels easy.',
      ],
      generators: ['voiceSlide'],
    },
    60,
    [
      { label: 'up to note 3', params: { top: 4, band: 80 }, bonus: 0 },
      { label: 'up to note 5', params: { top: 7, band: 80 }, bonus: 8, span: 7 },
      { label: 'up to note 8', params: { top: 12, band: 65 }, bonus: 16, span: 12 },
    ],
  ),
  stepped(
    {
      id: 'voice.pitch.echo',
      name: 'Echo a short tune',
      category: 'pitch',
      tier: 1,
      prerequisites: ['voice.pitch.match'],
      description: 'Listen to a tune of a few notes, then sing it straight back from memory.',
      tips: [
        'Listen to the whole tune before you sing. Humming along makes it harder to hear.',
        'Notice whether each note goes up, goes down or jumps.',
        'Missed one? The same tune comes round again in the next round.',
      ],
      generators: ['voiceEcho'],
    },
    72,
    [
      { label: 'tunes of 3 notes', params: { form: 'tune', notes: 3, band: 80 }, bonus: 0 },
      { label: 'tunes of 4 notes', params: { form: 'tune', notes: 4, band: 65 }, bonus: 8 },
      { label: 'tunes of 5 notes', params: { form: 'tune', notes: 5, band: 50 }, bonus: 16 },
    ],
  ),

  // Tier 2: jumps, and lines that last a whole breath.
  paced(
    {
      id: 'voice.interval.thirds',
      name: 'Small jumps',
      category: 'range',
      tier: 2,
      prerequisites: ['voice.pitch.five-note'],
      description: 'Jump over a note on the way up and on the way down: 1, 3, 5, 3, 1.',
      tips: [
        'Hear the landing note in your head before you jump.',
        'Land right on the note, without sliding up to it.',
        'Keep the jumps light and short.',
      ],
      generators: ['voicePattern'],
    },
    [66, 56, 92, 50],
  ),
  paced(
    {
      id: 'voice.interval.triad',
      name: 'Chord notes up to the top',
      category: 'range',
      tier: 2,
      prerequisites: ['voice.interval.thirds', 'voice.range.slides'],
      description: 'Climb the notes of a chord to the top one and come back down, as far as your easy notes reach.',
      tips: [
        'Let each note be a little lighter than the one below it.',
        'Come down as carefully as you went up.',
        'If the top note feels tight, stop there for today.',
      ],
      generators: ['voicePattern'],
    },
    [72, 60, 92, 60],
  ),
  stepped(
    {
      id: 'voice.breath.phrases',
      name: 'A whole line on one breath',
      category: 'breath',
      tier: 2,
      prerequisites: ['voice.pitch.hold', 'voice.pitch.five-note'],
      description: 'Sing a longer line without stopping for air in the middle.',
      tips: [
        'Breathe in low and quiet before the line starts.',
        'Spend the air evenly, and save a little for the last note.',
        'Out of air early? Start softer next time.',
      ],
      generators: ['voicePattern'],
    },
    72,
    [
      { label: 'up and back once', params: { pattern: 'line', times: 1, lastBeats: 2, band: 65 }, bonus: 0 },
      { label: 'up and back twice', params: { pattern: 'line', times: 2, lastBeats: 2, band: 50 }, bonus: 8 },
      { label: 'twice, with a long last note', params: { pattern: 'line', times: 2, lastBeats: 4, band: 50 }, bonus: 16 },
    ],
  ),

  // Tier 3: wider jumps and quicker notes.
  stepped(
    {
      id: 'voice.interval.leaps',
      name: 'Bigger jumps',
      category: 'range',
      tier: 3,
      prerequisites: ['voice.interval.triad'],
      description: 'Jump from note 1 straight up to a higher note, then land back home.',
      tips: [
        'Hear the top note first, then go straight to it.',
        'Keep your jaw and shoulders loose as you jump.',
        'A light top note is easier to land than a strong one.',
      ],
      generators: ['voicePattern'],
    },
    66,
    [
      { label: 'up to note 4', params: { pattern: 'leap', top: 5, band: 65 }, bonus: 0, span: 5 },
      { label: 'up to note 5', params: { pattern: 'leap', top: 7, band: 50 }, bonus: 6, span: 7 },
      { label: 'up to note 6', params: { pattern: 'leap', top: 9, band: 50 }, bonus: 12, span: 9 },
      { label: 'up to note 8', params: { pattern: 'leap', top: 12, band: 50 }, bonus: 18, span: 12 },
    ],
  ),
  paced(
    {
      id: 'voice.pitch.runs',
      name: 'Quick notes',
      category: 'pitch',
      tier: 3,
      prerequisites: ['voice.pitch.five-note', 'voice.interval.thirds'],
      description: 'Sing a run of quick notes cleanly, each one in its place.',
      tips: [
        'Keep it light. Quick notes need less air, not more.',
        'Think of the run as one shape instead of single notes.',
        'If the notes smear together, sing "da da da" to keep them apart.',
      ],
      generators: ['voicePattern'],
    },
    // The fastest it is ever asked for is 132: quick notes at 4.4 a second, which a voice can still place.
    [100, 100, 132, 92],
  ),

  // Tier 4: no help after the first note.
  stepped(
    {
      id: 'voice.pitch.alone',
      name: 'Stay in tune on your own',
      category: 'pitch',
      tier: 4,
      prerequisites: ['voice.pitch.hold', 'voice.interval.leaps'],
      description: 'Take one starting note, then sing on with only the click and keep every note in tune.',
      tips: [
        'Keep hearing note 1 in your head while you sing. It is home.',
        'Tired notes tend to sink. Think a little higher on the way down.',
        'After the silence, hear note 1 inside before you sing it.',
      ],
      generators: ['voiceEcho'],
    },
    60,
    [
      { label: 'five notes up and back', params: { form: 'alone', band: 50 }, bonus: 0 },
      // Each label is read on its own (a milestone, a check), so the last two say what is sung, not "the same".
      { label: 'five notes, then note 1 again', params: { form: 'alone', comeBack: true, band: 50 }, bonus: 10 },
      { label: 'note 1 again, right on the note', params: { form: 'alone', comeBack: true, band: 35 }, bonus: 20 },
    ],
  ),
]
