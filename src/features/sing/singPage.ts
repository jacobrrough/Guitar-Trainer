/**
 * What the song page for singing and the singer's library say and decide, apart from the screens:
 * which notes a singer sings in, the key of a song for them and how far "Lower" and "Higher" can move
 * it, the six levels with their best runs, the lines of a song for "Practise one line", and what of a
 * run is saved. Pure: no database, no sound, no React.
 *
 * The words follow docs/SINGING.md §10: short sentences, nothing that blames, and no number a beginner
 * cannot use. A result is counted in notes ("14 of 17 notes"), a key is moved in "small steps", and a
 * song that does not fit yet "comes later".
 */
import type { Chart } from '../../chart/types'
import type { ScoreRecord, SongRecord } from '../../db/db'
import { DEFAULT_RANGES, type RangeEdges } from '../../music/keys'
import { midiToName } from '../../music/pitch'
import { levelIndex, songKey, songSpan, VOICE_LEVELS, type VocalSong } from '../../songs/vocal'
import { GOOD_HIT_WEIGHT, SONG_LEVEL_UP_ACCURACY } from '../../training/constants'
import type { Profile, VoiceProfile } from '../../training/types'
import type { ScoreSummary } from '../play/scoring'

export const SING_COPY = {
  inYourKey: 'In your key',
  lowerVoiceKey: 'In a key for a lower voice',
  comesLater: 'Comes later',
  /** Under a key that is not the singer's own yet. */
  findYourNotes: 'Find your easy notes on the My voice page, and every song moves into your own key.',
  /** Why a song comes later, for a singer whose easy notes were found, and for one who sings in starting notes. */
  laterOwn: 'Songs with a smaller reach come first. This one will wait for you.',
  laterStarting: 'Find your easy notes on the My voice page. With your own notes it may fit.',
  myVoice: 'My voice',
  keyHelp: 'If the song sits too high or too low for you, move it a small step.',
  lower: 'Lower',
  higher: 'Higher',
  lowest: 'This is as low as this song can go.',
  highest: 'This is as high as this song can go.',
  fills: 'This song fills your easy notes, so it stays where it is.',
  /** The same, for a singer who sings in the starting notes of a lower voice because none are stored. */
  fillsLowerVoice: 'This song fills the easy notes for a lower voice, so it stays where it is.',
  keyTrouble: 'That did not save. Please try again.',
  levels: 'Choose a level',
  bestOnEach: 'Your best run on each level',
  notSung: 'Not sung yet',
  oneLine: 'Practise one line',
  wholeSong: 'The whole song',
  oneLineNote: 'One line on its own is for practice. It is not saved as a result.',
  sing: 'Sing',
  practise: 'Practise this line',
  listenHint: 'On the next screen you can listen first, then sing.',
  notReady: 'The song could not be made ready this time. Go back and open it again.',
  back: 'Back',
  again: 'Sing again',
  backToSong: 'Back to the song',
  songs: 'Songs',
  nextLevel: (name: string) => `Next level: ${name}`,
  readyForNext: (name: string) => `Lovely. You are ready for "${name}".`,
  newBest: 'That is your best so far on this level.',
  /**
   * Every note counted, and too few of them were right in the middle, or held long enough, for the level
   * to be done well. In the words the lessons use for the screen: the dot is the voice, a bar is a note.
   */
  closer: 'Next, keep your dot in the middle of each bar, right to the end.',
  practiceRun: 'A practice line. It was not saved as a result.',
  notHere: 'This song is not here to sing.',
  backToSongs: 'Back to songs',
  librarySubtitle: 'Songs to sing. Each one is moved into your own key.',
  libraryStarting: 'These songs are in a key for a lower voice. Find your easy notes on the My voice page to sing them in your own key.',
  noneFit: 'No song fits your easy notes yet. Find your easy notes again on the My voice page.',
  openTrouble: 'That song could not be opened. Please try again.',
} as const

/** Where a song to sing is opened, by the id of its stored row; `level` (index 0 to 5) opens it on that level. */
export function singPath(rowId: number, level?: number): string {
  return level === undefined ? `/sing/${rowId}` : `/sing/${rowId}?level=${level}`
}

/** The level asked for in an address (`?level=2`), or undefined when none was, or what stands there is no number. */
export function askedLevel(param: string | null): number | undefined {
  if (param === null || param.trim() === '') return undefined
  const level = Number(param)
  return Number.isFinite(level) ? level : undefined
}

/**
 * Whose notes a song is placed in:
 * - `own`: easy notes that were found by listening, or moved by hand afterwards;
 * - `starting`: one of the two starting ranges the singer picked instead ("Lower voice", "Higher voice");
 * - `none`: nothing stored. The singer then sings in the lower starting range, exercises and songs
 *   alike, so a lesson's round and its song are never an octave apart.
 */
export type RangeKind = 'own' | 'starting' | 'none'

export interface SingingRange extends RangeEdges {
  kind: RangeKind
}

/**
 * The notes a singer sings in. A singer always has some: without a stored range it is the starting
 * range of a lower voice, never the key a song happens to be written in (that is an octave higher, and
 * `useVocalRun` places the song by the same rule).
 */
export function singingRange(voice: Pick<VoiceProfile, 'range'> | undefined): SingingRange {
  const stored = voice?.range
  if (!stored) return { low: DEFAULT_RANGES.lower.low, high: DEFAULT_RANGES.lower.high, kind: 'none' }
  return { low: stored.low, high: stored.high, kind: stored.source === 'default' ? 'starting' : 'own' }
}

export interface SongKeyView {
  /** False when the song is wider than the range: it must not be sung, and nothing below moves it. */
  fits: boolean
  /** Semitones the song is moved from where it is written. */
  shift: number
  /** Lowest and highest note of the song in this key (MIDI numbers). */
  low: number
  high: number
  /** What the stored key choice really moved, in semitones from the key chosen for the range. */
  applied: number
  /** What to store for one small step lower or higher; null when there is nothing further that way. */
  lower: number | null
  higher: number | null
}

/**
 * The key of a song for a range, and what "Lower" and "Higher" would store.
 *
 * The trap: a stored choice can ask for more than the range gives (three steps up where there is room
 * for one). Counting on from the stored number, the next taps on "Lower" would change nothing. So the
 * stored choice is first read as what it really moved, and a step is offered only when it moves the
 * song by exactly one semitone. Three small steps either way is the furthest a choice goes.
 */
export function songKeyView(song: VocalSong, range: RangeEdges, stored: number | undefined): SongKeyView {
  const span = songSpan(song)
  const chosen = songKey(song, range)
  if (!chosen.fits) return { fits: false, shift: chosen.shift, low: span.low + chosen.shift, high: span.high + chosen.shift, applied: 0, lower: null, higher: null }
  const shift = songKey(song, range, stored).shift
  const applied = shift - chosen.shift
  const step = (by: 1 | -1): number | null => (songKey(song, range, applied + by).shift === shift + by ? applied + by : null)
  return { fits: true, shift, low: span.low + shift, high: span.high + shift, applied, lower: step(-1), higher: step(1) }
}

/** "Moved 2 small steps lower.", or null for a song that sits where the app put it. */
function movedLine(applied: number): string | null {
  if (applied === 0) return null
  const steps = Math.abs(applied)
  return `Moved ${steps} small ${steps === 1 ? 'step' : 'steps'} ${applied < 0 ? 'lower' : 'higher'}.`
}

const notesText = (range: RangeEdges): string => `${midiToName(range.low)} to ${midiToName(range.high)}`
/** How many notes lie between two notes, both counted, as a singer would count them on a keyboard. */
const noteCount = (range: RangeEdges): number => range.high - range.low + 1

export interface KeyCard extends Pick<SongKeyView, 'fits' | 'shift' | 'lower' | 'higher'> {
  /** "In your key", "In a key for a lower voice" or "Comes later". */
  title: string
  /** Where the song lies: its lowest and highest note, or how wide it is when it does not fit. */
  notes: string
  /** The singer's notes beside it. */
  yours: string
  /** How far the singer (or the Coach) moved it; null when it was not moved. */
  moved: string | null
  /** Why it comes later; null for a song that fits. */
  reason: string | null
  /** What to do about a key that is not the singer's own yet; null once they have easy notes stored. */
  hint: string | null
  /** What to say under a "Lower" or "Higher" that has nowhere to go; null while both can move, and for a song that does not fit. */
  end: string | null
}

/** The key card of a song for one singer, as the song page and the library show it. */
export function keyCard(song: VocalSong, voice: Pick<VoiceProfile, 'range' | 'keyNudge'> | undefined): KeyCard {
  const range = singingRange(voice)
  const key = songKeyView(song, range, voice?.keyNudge?.[song.id])
  // Notes nobody found or chose are not called the singer's own, on any line of the card.
  const theirs = range.kind !== 'none'
  const yours = theirs ? `Your easy notes: ${notesText(range)}` : `Easy notes for a lower voice: ${notesText(range)}`
  if (!key.fits) {
    return {
      fits: false,
      shift: key.shift,
      lower: null,
      higher: null,
      title: SING_COPY.comesLater,
      notes: `This song reaches across ${noteCount(songSpan(song))} notes. ${theirs ? 'Your easy notes are' : 'The easy notes for a lower voice are'} ${noteCount(range)} for now.`,
      yours,
      moved: null,
      reason: range.kind === 'own' ? SING_COPY.laterOwn : SING_COPY.laterStarting,
      hint: null,
      end: null,
    }
  }
  const fills = theirs ? SING_COPY.fills : SING_COPY.fillsLowerVoice
  const end = key.lower === null && key.higher === null ? fills : key.lower === null ? SING_COPY.lowest : key.higher === null ? SING_COPY.highest : null
  return {
    fits: true,
    shift: key.shift,
    lower: key.lower,
    higher: key.higher,
    title: theirs ? SING_COPY.inYourKey : SING_COPY.lowerVoiceKey,
    notes: `This song: ${notesText(key)}`,
    yours,
    moved: movedLine(key.applied),
    reason: null,
    hint: theirs ? null : SING_COPY.findYourNotes,
    end,
  }
}

/** Nine notes in ten: from here a level is done well, and the next one is offered. It is the mark at which the Coach moves a song up. */
export const READY_FOR_NEXT = SONG_LEVEL_UP_ACCURACY
/** From here a level is well under way. */
const UNDER_WAY = 0.7

/**
 * How much of a run counts, as the Coach counts it: a note sung in the middle of its band counts in
 * full, a note inside the band but off the middle for four fifths, and a run with no notes for nothing.
 *
 * The trap: the share of notes that were "on the note" is a different number. A singer who is a little
 * flat throughout is on every note of a wide band ("17 of 17 notes") and the Coach still keeps the
 * level, because a narrower band further up would count none of them. What the page marks as done
 * well, and when it offers the next level, has to be the Coach's number, or the card says "you are
 * ready" and the next plan says otherwise.
 */
function countedShare(run: Pick<ScoreRecord, 'perfects' | 'goods' | 'misses'>): number {
  const notes = run.perfects + run.goods + run.misses
  return notes > 0 ? (run.perfects + GOOD_HIT_WEIGHT * run.goods) / notes : 0
}

export interface LevelRow {
  /** 0 to 5: what a song item stores, and what `useVocalRun` takes. */
  index: number
  /** 1 to 6: what is written on the button, and the key the best run is stored under. */
  number: number
  name: string
  about: string
  /** "Best so far: 14 of 17 notes", or "Not sung yet". */
  best: string
  /** How the button is tinted. There is no tint for "bad": a level that went badly is simply not done yet. */
  tone: 'default' | 'accent' | 'ok'
}

/** The number a level is known by on the page, and the key its best run is stored under (as for a guitar song). */
const levelNumber = (index: number): number => index + 1

function bestLine(best: ScoreRecord | undefined): string {
  if (!best) return SING_COPY.notSung
  const notes = best.perfects + best.goods + best.misses
  return `Best so far: ${best.perfects + best.goods} of ${notes} ${notes === 1 ? 'note' : 'notes'}`
}

/** The six levels of a song with the singer's best run on each, from the best results of its stored row. */
export function levelRows(bestScores: SongRecord['bestScores']): LevelRow[] {
  return VOICE_LEVELS.map((level, index) => {
    const best = bestScores[String(levelNumber(index))]
    const share = best ? countedShare(best) : 0
    const tone = share >= READY_FOR_NEXT ? 'ok' : share >= UNDER_WAY ? 'accent' : 'default'
    return { index, number: levelNumber(index), name: level.name, about: level.about, best: bestLine(best), tone }
  })
}

/** "Whole tune": where a song that was never sung starts for a singer who is past the echo levels. The Coach starts it there too. */
const WHOLE_TUNE = 2

/** What the page knows of the singer when it opens a song: what they answered in the set-up, and whether the course is behind them. */
export type SingerSoFar = Pick<Profile, 'experience' | 'firstStepsDoneAt'>

/**
 * Whether the echo levels are behind this singer: they said in the set-up that they have sung before,
 * or the First steps course is ended (finished or left). The Coach's own test for a beginner reads
 * ratings inside the planner and is not known to a page; this is the same line drawn from the profile.
 */
function pastTheEchoLevels(singer: SingerSoFar | undefined): boolean {
  if (!singer) return false
  return (singer.experience !== undefined && singer.experience !== 'new') || singer.firstStepsDoneAt !== undefined
}

/**
 * The level the page opens on: the one asked for in the address, else the one sung last. A song that
 * was never sung opens on the first level ("Echo each line"), which asks least, for a beginner and
 * wherever nothing is known of the singer; and on "Whole tune" for a singer who has sung before, who
 * would only be held up by echoing a tune line by line.
 * `lastLevel` is the level number the song row stores (1 to 6).
 */
export function startLevel(lastLevel: number | null, asked?: number, singer?: SingerSoFar): number {
  if (asked !== undefined) return levelIndex(asked)
  if (lastLevel !== null) return levelIndex(lastLevel - 1)
  return pastTheEchoLevels(singer) ? WHOLE_TUNE : 0
}

/** The level to offer after a run: the next one up when the Coach would move the song up after it (`countedShare`), or none. */
export function nextLevelAfter(level: number, run: Pick<ScoreSummary, 'perfects' | 'goods' | 'misses'>): number | null {
  return countedShare(run) >= READY_FOR_NEXT && level < VOICE_LEVELS.length - 1 ? level + 1 : null
}

/**
 * What is still to do after a run in which every note counted and the level is not done well yet:
 * without it "17 of 17 notes" with no next level on offer would be a riddle. Null for every other run
 * (a note that did not count has a tip of its own).
 */
export function closerLine(run: Pick<ScoreSummary, 'perfects' | 'goods' | 'misses'>): string | null {
  const everyNote = run.misses === 0 && run.perfects + run.goods > 0
  return everyNote && countedShare(run) < READY_FOR_NEXT ? SING_COPY.closer : null
}

/** A counted run as the song row keeps it: under the level's number, and always at speed 1 (a song to sing is never slowed down). */
export function resultRecord(level: number, summary: ScoreSummary, now: number): ScoreRecord {
  return {
    level: levelNumber(level),
    score: summary.score,
    accuracy: summary.accuracy,
    maxStreak: summary.maxStreak,
    perfects: summary.perfects,
    goods: summary.goods,
    misses: summary.misses,
    speed: 1,
    date: now,
  }
}

/** Whether a run is the best so far on its level, by the same rule the song row keeps a best by (`recordResult`). */
export function isNewBest(before: ScoreRecord | undefined, summary: Pick<ScoreSummary, 'score'>): boolean {
  return !before || summary.score > before.score
}

/**
 * Whether a finished run is a result for the song. One line on its own is practice: it must never be
 * handed to `recordSongPlay`, where it would count as a run of the whole song at that level.
 */
export function savesAsResult(chart: Pick<Chart, 'voice'>): boolean {
  return chart.voice !== undefined && chart.voice.onlyLine === undefined
}

/**
 * Whether "Sing again" may start the run that is on screen once more, there and then. Otherwise the
 * result is let go, the song is made ready as it is now, and the start button comes back.
 *
 * - `sameRun`: the run on screen is still the one made for this singer (same key, level and line).
 * - `saving`: the run is still on its way to the Coach, who may answer by moving the key.
 * - `keyLowered`: the Coach has moved the song down after this run.
 *
 * The trap is the moment after the Coach's answer: the key choice is already stored, but the page has
 * not been handed the new arrangement yet, so the run on screen still looks like the latest one. A
 * pass sung in it would be counted as a run in the new key.
 */
export function singsAgainAtOnce(run: { sameRun: boolean; saving: boolean; keyLowered: boolean }): boolean {
  return run.sameRun && !run.saving && !run.keyLowered
}

/**
 * Words that are written with a hyphen. In the syllables of a song a hyphen only says "the word goes
 * on", so "one-" + "horse" would come back together as "onehorse", like "Ma-" + "ry" as "Mary".
 */
const WRITTEN_WITH_HYPHEN = new Map([['onehorse', 'one-horse']])

/**
 * The words of one line, put back together from its syllables: a trailing hyphen joins a syllable to
 * the next, and a syllable carried over a second note ('') adds nothing, wherever in the word it falls.
 */
export function lineWords(song: VocalSong, line: number): string {
  let text = ''
  let joined = true
  for (const [offset, , syllable] of song.lines[line] ?? []) {
    if (offset === null || !syllable) continue
    const open = syllable.endsWith('-')
    text += (joined ? '' : ' ') + (open ? syllable.slice(0, -1) : syllable)
    joined = open
  }
  return text
    .split(' ')
    .map((word) => WRITTEN_WITH_HYPHEN.get(word.toLowerCase()) ?? word)
    .join(' ')
}

/** One choice per line for "Practise one line": "Line 2: little lamb little lamb". A line without words is its number alone. */
export function lineChoices(song: VocalSong): { index: number; label: string }[] {
  return song.lines.map((_, index) => {
    const words = lineWords(song, index)
    return { index, label: words ? `Line ${index + 1}: ${words}` : `Line ${index + 1}` }
  })
}

/**
 * What stands over a run and under its start button: the level, and for one line on its own the line
 * and that it is for practice (the singer should know before they sing that it is not a result).
 */
export function runWords(level: number, notes: number, lineLabel: string | null): { heading: string; ready: string } {
  const name = VOICE_LEVELS[levelIndex(level)].name
  if (lineLabel !== null) return { heading: `${lineLabel} · ${name}`, ready: `${lineLabel} · for practice` }
  return { heading: name, ready: `${name} · ${notes} ${notes === 1 ? 'note' : 'notes'} to sing` }
}

export interface SongCard {
  /** The bundled id (`sing-…`): the stored row is found, or written, by it when the song is opened. */
  id: string
  title: string
  credit: string
  description: string
  key: KeyCard
  levels: LevelRow[]
  plays: number
  /** "Sung 4 times"; null for a song that was never sung. */
  sung: string | null
}

function sungLine(plays: number): string | null {
  if (plays <= 0) return null
  return plays === 1 ? 'Sung once' : `Sung ${plays} times`
}

/**
 * The library of a singer: every song to sing, once. Those that fit the singer's notes come first, in
 * the order of the course; the others are listed under "Comes later" with the reason. A song whose
 * skills are not under way yet is listed like any other: only the Coach's own picks wait for those.
 *
 * `rows` are the stored rows of the songs to sing, for the best runs and the play count. A song without
 * a row yet (it is written when first opened) simply has none.
 */
export function songCards(
  songs: readonly VocalSong[],
  voice: Pick<VoiceProfile, 'range' | 'keyNudge'> | undefined,
  rows: readonly (Pick<SongRecord, 'bestScores' | 'playCount'> & { builtinId?: string })[],
): { now: SongCard[]; later: SongCard[] } {
  const cards = songs.map((song): SongCard => {
    const row = rows.find((r) => r.builtinId === song.id)
    const plays = row?.playCount ?? 0
    return { id: song.id, title: song.title, credit: song.credit, description: song.description, key: keyCard(song, voice), levels: levelRows(row?.bestScores ?? {}), plays, sung: sungLine(plays) }
  })
  return { now: cards.filter((c) => c.key.fits), later: cards.filter((c) => !c.key.fits) }
}
