import { UNLOCK_RATING } from './constants'
import type { SkillCategory, SkillDef } from './types'

type SkillInput = Omit<SkillDef, 'startTempo'> & { startTempo?: number }

/** startTempo defaults to refTempo × 0.85 rounded to the nearest 5 bpm. */
function def(input: SkillInput): SkillDef {
  const startTempo = input.startTempo ?? Math.round((input.refTempo * 0.85) / 5) * 5
  return { ...input, startTempo }
}

export const SKILLS: SkillDef[] = [
  // Tier 0: first steps. No prerequisites; the planner keeps brand-new learners here first.
  def({
    id: 'basics.open-strings',
    name: 'Open strings on the beat',
    category: 'picking',
    tier: 0,
    prerequisites: [],
    refTempo: 60,
    startTempo: 50,
    targetTempo: 80,
    description: 'Pick single open strings in time: your first notes, with nothing pressed down by your other hand.',
    tips: [
      'Hold the pick between the thumb and the side of the index finger, with only a few millimetres showing.',
      'Rest the side of your strumming hand (the hand holding the pick) lightly near the bridge (the bar where the strings end on the body) so it always knows where the strings are.',
      'Pick down through the string with a small wrist movement and let the note ring until the next one.',
    ],
    generators: ['openStrings'],
  }),
  def({
    id: 'basics.first-frets',
    name: 'First frets, one finger each',
    category: 'fretting',
    tier: 0,
    prerequisites: [],
    refTempo: 60,
    startTempo: 50,
    targetTempo: 80,
    description: 'Press frets 1, 2 and 3 on one string with the index, middle and ring finger, back to the open string in between.',
    tips: [
      'Press with the fingertip just behind the metal bar (the fret), not on top of it, with the thumb resting behind the neck.',
      'Press only as hard as a clean note needs; a buzz means move closer to the fret or press a little more.',
      'Keep the other fingers hovering over their own frets so they are ready.',
    ],
    generators: ['firstFrets'],
  }),
  def({
    id: 'fret.single-string',
    name: 'Single notes on one string',
    category: 'fretting',
    tier: 1,
    prerequisites: [],
    refTempo: 60,
    targetTempo: 100,
    description: 'Fret clean single notes up and down one string, one finger per fret.',
    tips: [
      'Press just behind the metal bar (the fret) with the fingertip, not the soft pad, so the note rings without buzzing.',
      'Keep your thumb roughly behind the neck and your fingers curved above the string.',
      'Lift each finger only as far as needed; hovering close to the string saves time and effort.',
    ],
    generators: ['firstFrets', 'melody'],
  }),
  def({
    id: 'fret.cross-string',
    name: 'Notes across strings, open position',
    category: 'fretting',
    tier: 1,
    prerequisites: ['fret.single-string'],
    refTempo: 60,
    targetTempo: 100,
    description: 'Move melodies between neighbouring strings in open position while keeping every note clear.',
    tips: [
      'Mute strings you are not playing with the side of the finger pressing the string or the palm of your strumming hand.',
      'Look ahead to the next string before you leave the current note so the pick and finger arrive together.',
      'Stay relaxed in the hand pressing the strings; squeezing harder does not make notes cleaner.',
    ],
    generators: ['melody', 'stringSkipping'],
  }),
  def({
    id: 'fret.chromatic',
    name: 'Finger independence (spider)',
    category: 'fretting',
    tier: 1,
    prerequisites: ['fret.single-string'],
    refTempo: 60,
    targetTempo: 120,
    description: 'Play the 1-2-3-4 chromatic pattern across the strings to train each finger separately.',
    tips: [
      'Assign one finger per fret and keep the fingers close to the strings between notes.',
      'Start slowly and keep all four fingers down on the fretboard while they are not in use, where comfortable.',
      'Keep the wrist straight and the thumb low; tension builds quickly in the pinky.',
    ],
    generators: ['chromatic'],
  }),
  def({
    id: 'fret.shifts',
    name: 'Position shifts',
    category: 'fretting',
    tier: 2,
    prerequisites: ['fret.cross-string'],
    refTempo: 70,
    targetTempo: 110,
    description: 'Move the whole hand that presses the strings along the neck and land accurately on the target fret.',
    tips: [
      'Lead the shift with the finger that is already playing and let the thumb glide along behind the neck.',
      'Ease the finger pressure while moving but keep light contact, then re-press on arrival.',
      'Learn the fret markers (3, 5, 7, 9, 12) so you can find landing spots without looking hard.',
    ],
    generators: ['melody'],
  }),
  def({
    id: 'pick.downstrokes',
    name: 'Downstrokes on the beat',
    category: 'picking',
    tier: 1,
    prerequisites: [],
    refTempo: 60,
    targetTempo: 120,
    description: 'Strike the string with a steady downstroke exactly on each beat of the click.',
    tips: [
      'Hold the pick between thumb and the side of the index finger with only a small tip showing.',
      'Move from the wrist with a loose forearm instead of the whole arm.',
      'Listen to the click and aim to pluck on it, not after it; a consistent small motion keeps timing steady.',
    ],
    generators: ['powerChordRiff', 'metronomeSteady'],
  }),
  def({
    id: 'pick.alternate-8',
    name: 'Alternate picking, eighths',
    category: 'picking',
    tier: 2,
    prerequisites: ['pick.downstrokes', 'fret.chromatic'],
    refTempo: 70,
    targetTempo: 140,
    description: 'Alternate down and up strokes on eighth notes, with downs on the beat and ups on the off-beat.',
    tips: [
      'Keep your strumming hand moving down-up continuously, even when skipping a string, so the beat stays in your hand.',
      'Use a small motion; the pick should only go slightly past the string on each stroke.',
      'Practise slowly with a click and favour evenness of volume between down and up strokes.',
    ],
    generators: ['chromatic', 'stringSkipping'],
  }),
  def({
    id: 'pick.alternate-16',
    name: 'Alternate picking, sixteenths',
    category: 'picking',
    tier: 3,
    prerequisites: ['pick.alternate-8'],
    refTempo: 60,
    targetTempo: 110,
    description: 'Alternate pick four notes per beat with even volume and timing.',
    tips: [
      'Reduce the motion even further and stay relaxed; tension is the main speed limiter.',
      'Count 1-e-and-a and make sure each beat starts with a downstroke.',
      'Build speed in small steps: raise the tempo only after several clean repetitions.',
    ],
    generators: ['chromatic'],
  }),
  def({
    id: 'rhythm.syncopation',
    name: 'Off-beat rhythms and ties',
    category: 'picking',
    tier: 3,
    prerequisites: ['pick.alternate-8'],
    refTempo: 70,
    targetTempo: 110,
    description: 'Play accents and notes on the off-beats and hold notes tied across the beat.',
    tips: [
      'Keep your strumming hand moving down-up even on the beats where you do not strike the string.',
      'Count the eighth notes out loud ("1 and 2 and") and tap your foot on the numbers.',
      'For ties, let the note ring through the beat without re-picking it.',
    ],
    generators: ['subdivisionSwitch'],
  }),
  def({
    id: 'rhythm.triplets',
    name: 'Triplet feel and shuffle',
    category: 'picking',
    tier: 3,
    prerequisites: ['pick.alternate-8'],
    refTempo: 70,
    targetTempo: 120,
    description: 'Divide each beat into three equal parts and play a triplet or shuffle feel.',
    tips: [
      'Count "1-trip-let, 2-trip-let" so three notes fit evenly into every beat.',
      'Because triplets have an odd number of notes, down-up alternation flips each beat; keep the motion going anyway.',
      'For a shuffle, play the first and third note of each triplet and rest on the middle one.',
    ],
    generators: ['subdivisionSwitch'],
  }),
  def({
    id: 'chord.open',
    name: 'Open chords',
    category: 'chords',
    tier: 1,
    prerequisites: ['fret.cross-string'],
    refTempo: 50,
    targetTempo: 80,
    description: 'Fret and strum the open chords E, A, D, G, C, Em, Am and Dm cleanly.',
    tips: [
      'Arch your fingers and press with the fingertips so they do not touch neighbouring strings.',
      'Strum and pick each string slowly to check that every note rings; fix any that buzz or mute.',
      'Place all the fingers of a chord down together rather than one at a time.',
    ],
    generators: ['chordChanges'],
    provisional: true,
  }),
  def({
    id: 'chord.changes-open',
    name: 'Changes between open chords',
    category: 'chords',
    tier: 2,
    prerequisites: ['chord.open'],
    refTempo: 50,
    targetTempo: 100,
    description: 'Switch between open chords on the beat without stopping the strumming hand.',
    tips: [
      'Look for common fingers between two chords and keep them on the strings, or slide them, as you change.',
      'Move the fingers as one shape and aim at the next chord while still playing the current one.',
      'Keep the strumming hand going and let the chord arrive late rather than stopping the rhythm.',
    ],
    generators: ['chordChanges'],
    provisional: true,
  }),
  def({
    id: 'chord.power',
    name: 'Power chords and palm muting',
    category: 'chords',
    tier: 2,
    prerequisites: ['pick.downstrokes'],
    refTempo: 70,
    targetTempo: 140,
    description: 'Play two- and three-note power chords and tighten them with palm muting.',
    tips: [
      'Fret the root with the index finger and the fifth with the ring finger, and mute the unused strings.',
      'For palm muting rest the edge of your strumming-hand palm lightly on the strings right next to the bridge (the bar where the strings end on the body).',
      'Move the shape up and down the neck as one block; the same shape works for any root.',
    ],
    generators: ['powerChordRiff'],
    provisional: true,
  }),
  def({
    id: 'chord.barre',
    name: 'Barre chords',
    category: 'chords',
    tier: 3,
    prerequisites: ['chord.changes-open'],
    refTempo: 50,
    targetTempo: 90,
    description: 'Press all strings across one fret with the index finger to play F and Bm style shapes.',
    tips: [
      'Use the bony side edge of the index finger and place it right behind the fret, not in the middle of the fret space.',
      'Pull gently towards you with the arm and keep the thumb behind the neck to help the pressure.',
      'Practise on frets higher up the neck first where the strings are easier to press, then work down to F.',
    ],
    generators: ['chordChanges'],
    provisional: true,
  }),
  def({
    id: 'chord.strum-patterns',
    name: 'Strumming patterns',
    category: 'chords',
    tier: 2,
    prerequisites: ['chord.open', 'pick.downstrokes'],
    refTempo: 70,
    targetTempo: 120,
    description: 'Strum patterns such as D DU UDU with a steady down-up arm motion.',
    tips: [
      'Keep the strumming arm swinging down and up in steady eighths and simply miss the strings on the beats you skip.',
      'Accent the downbeats a little and play the upstrokes lightly on the top few strings.',
      'Learn the pattern on a muted or single chord first, then add chord changes.',
    ],
    generators: ['strumPattern', 'chordChanges'],
    provisional: true,
  }),
  def({
    id: 'chord.sevenths',
    name: 'Seventh and add9 chords',
    category: 'chords',
    tier: 3,
    prerequisites: ['chord.changes-open'],
    refTempo: 60,
    targetTempo: 100,
    description: 'Learn dominant 7th, minor 7th and add9 chord shapes and move to and from them cleanly.',
    tips: [
      'Many 7th chords are an open chord with one finger lifted or moved, so learn them as small changes from the basic chord.',
      'Check each string by picking the notes one at a time before you strum.',
      'Listen to the colour: 7ths add tension, minor 7ths feel mellow and add9 sounds open and bright.',
    ],
    generators: ['chordChanges'],
    provisional: true,
  }),
  def({
    id: 'lead.pent-box1',
    name: 'Minor pentatonic box 1',
    category: 'lead',
    tier: 2,
    prerequisites: ['fret.cross-string', 'pick.alternate-8'],
    refTempo: 70,
    targetTempo: 140,
    description: 'Play the first minor pentatonic shape up and down with alternate picking.',
    tips: [
      'Use the index finger on the first fret of the box and the pinky on the last, one finger per fret.',
      'Memorise the pattern of two notes per string and say the note names as you play.',
      'Practise it from the low root note up to the top and back down, with a click.',
    ],
    generators: ['scaleRun'],
  }),
  def({
    id: 'lead.pent-boxes',
    name: 'Pentatonic boxes 2 to 5',
    category: 'lead',
    tier: 3,
    prerequisites: ['lead.pent-box1', 'fret.shifts'],
    refTempo: 70,
    targetTempo: 130,
    description: 'Learn the other four pentatonic shapes and connect them across the neck.',
    tips: [
      'Each box overlaps the next, so learn the last two notes of one shape as the first notes of the next.',
      'Always know where the root notes are in each box so you can land on them.',
      'Practise sliding from one box into the next on a single string before playing whole runs.',
    ],
    generators: ['scaleRun'],
  }),
  def({
    id: 'lead.major-scale',
    name: 'Major scale, one position',
    category: 'lead',
    tier: 3,
    prerequisites: ['lead.pent-box1'],
    refTempo: 70,
    targetTempo: 130,
    description: 'Play the major scale in a single fretboard position, up and down, in time.',
    tips: [
      'Use one finger per fret across four frets and shift your hand only if the pattern requires it.',
      'Sing or say the scale degrees 1 to 7 to link the shape to the sound.',
      'Start on the root and finish on the root so each run sounds resolved.',
    ],
    generators: ['scaleRun'],
  }),
  def({
    id: 'lead.hammer-pull',
    name: 'Hammer-ons and pull-offs',
    category: 'lead',
    tier: 2,
    prerequisites: ['fret.cross-string'],
    refTempo: 70,
    targetTempo: 120,
    description: 'Sound notes with the hand that presses the strings alone by hammering onto and pulling off the string.',
    tips: [
      'For a hammer-on bring the finger down firmly and quickly on the fret, with the tip just behind the metal bar (the fret).',
      'For a pull-off flick the finger sideways slightly as it leaves so it plucks the string.',
      'Aim for the hammered or pulled note to be as loud as the picked one.',
    ],
    generators: ['legatoLick'],
  }),
  def({
    id: 'lead.slides',
    name: 'Slides into and out of notes',
    category: 'lead',
    tier: 2,
    prerequisites: ['fret.shifts'],
    refTempo: 70,
    targetTempo: 120,
    description: 'Glide the fretting finger along the string between frets to join or decorate notes.',
    tips: [
      'Keep steady pressure while sliding so the note keeps sounding, but not so hard that the finger sticks.',
      'Know the target fret before you start and arrive on the beat.',
      'For a slide into a note start two to three frets away; for a slide out, release as you glide off.',
    ],
    generators: ['slideLick'],
  }),
  def({
    id: 'lead.bends',
    name: 'Half and whole-step bends',
    category: 'lead',
    tier: 3,
    prerequisites: ['lead.pent-box1'],
    refTempo: 60,
    targetTempo: 100,
    description: 'Push a string sideways to raise its pitch by a half or whole step and hold it in tune.',
    tips: [
      'Support the bending finger with the fingers behind it on the same string and use the wrist, not just the finger.',
      'Play the target note first, then bend until the pitch matches it.',
      'A whole step is about the same as two frets higher; check yourself against the tuner.',
    ],
    generators: ['bendTargets'],
  }),
  def({
    id: 'lead.vibrato',
    name: 'Vibrato control',
    category: 'lead',
    tier: 4,
    prerequisites: ['lead.bends'],
    refTempo: 80,
    startTempo: 60,
    targetTempo: 80,
    description: 'Add a steady, even pitch wobble to sustained notes.',
    tips: [
      'Rotate the wrist and forearm in a rocking motion instead of moving only the finger.',
      'Start with small, slow oscillations and make them even before making them wider.',
      'Bend slightly up and return to the true pitch so the note never sounds flat.',
    ],
    generators: ['bendTargets'],
  }),
  def({
    id: 'time.metronome',
    name: 'Playing locked to a click',
    category: 'timing',
    tier: 1,
    prerequisites: [],
    refTempo: 60,
    targetTempo: 140,
    description: 'Play so that every note lands exactly on the metronome click.',
    tips: [
      'Tap your foot with the click and play on it; listen so that the click and your note sound as one.',
      'If you are always early or late, adjust a little rather than overcorrecting.',
      'Practise on simple open strings first so that timing is the only thing you think about.',
    ],
    generators: ['metronomeSteady', 'strumPattern'],
  }),
  def({
    id: 'time.subdivisions',
    name: 'Switching subdivisions',
    category: 'timing',
    tier: 3,
    prerequisites: ['pick.alternate-16', 'rhythm.triplets'],
    refTempo: 70,
    targetTempo: 110,
    description: 'Change between quarter notes, eighths, triplets and sixteenths without losing the beat.',
    tips: [
      'Keep your foot tapping steadily on the beat while the note density changes around it.',
      'Count out loud the subdivision you are about to play before the bar starts.',
      'Plan the change one beat early so the first note of the new bar is not rushed.',
    ],
    generators: ['subdivisionSwitch'],
  }),
  def({
    id: 'ear.tuning',
    name: 'Tuning by ear',
    category: 'ear',
    tier: 1,
    prerequisites: [],
    refTempo: 80,
    startTempo: 60,
    targetTempo: 80,
    description: 'Tune each string by listening and match the pitch, then check with the tuner.',
    tips: [
      'Tune each string up to the pitch from below; if you overshoot, go down and approach again.',
      'Listen for the slow "wah-wah" beating between two notes, which gets slower as they come into tune.',
      'Use the fifth-fret note on the lower string to match the next open string, except from G to B (fourth fret).',
    ],
    generators: ['tuneByEar'],
  }),
]

export const SKILLS_BY_ID: Record<string, SkillDef> = Object.fromEntries(SKILLS.map((s) => [s.id, s]))

export const CATEGORY_LABELS: Record<SkillCategory, string> = {
  fretting: 'Fretting',
  picking: 'Picking and rhythm',
  chords: 'Chords',
  lead: 'Lead',
  timing: 'Timing',
  ear: 'Ear',
}

export function getSkill(id: string): SkillDef {
  const skill = SKILLS_BY_ID[id]
  if (!skill) throw new Error(`Unknown skill id: ${id}`)
  return skill
}

/** True when every prerequisite has a rating of at least UNLOCK_RATING (missing = 0). */
export function isUnlocked(skillId: string, ratings: Record<string, number>): boolean {
  return getSkill(skillId).prerequisites.every((p) => (ratings[p] ?? 0) >= UNLOCK_RATING)
}

/** Prerequisites before dependants; ties broken by tier then id. Throws on a cycle or unknown prerequisite. */
export function topologicalOrder(skills: SkillDef[] = SKILLS): SkillDef[] {
  const byId = new Map(skills.map((s) => [s.id, s]))
  const remaining = [...skills].sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id))
  const done = new Set<string>()
  const result: SkillDef[] = []
  while (remaining.length > 0) {
    const index = remaining.findIndex((s) =>
      s.prerequisites.every((p) => {
        if (!byId.has(p)) throw new Error(`Unknown prerequisite ${p} for ${s.id}`)
        return done.has(p)
      }),
    )
    if (index < 0) throw new Error('Skill prerequisite graph contains a cycle')
    const [next] = remaining.splice(index, 1)
    done.add(next.id)
    result.push(next)
  }
  return result
}

export function skillsForCategory(category: SkillCategory): SkillDef[] {
  return SKILLS.filter((s) => s.category === category)
}
