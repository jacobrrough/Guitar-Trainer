# Singing

One app, two instruments. This document is the design for the voice side: what is stored, how singing is scored, how songs and exercises are placed in a singer's own range, how the Coach treats voice skills, the course, the screens, the proof, and what the owner has to check on a real phone.

## 1. Decisions in one page

| Question | Decision | Reason |
|---|---|---|
| How does a screen know it is voice? | The chart says so: `chart.voice` is set. The shared Player builds the voice tracker and the pitch lanes from it. | Every wrapper of the Player (Today blocks, lessons, checks, songs) works without a new prop and cannot forget one. |
| Schema | Dexie version 5 changes only `sessions` to `'++id, date, &[instrument+date]'` and stamps old sessions `'guitar'`. | Smallest change that gives one plan per day per instrument; primary keys cannot be changed in place. |
| Other tables | Namespaced ids, a second profile row (id 2), an optional `instrument` field read as guitar when missing. | No rewrite of any other row; song rows with audio bytes are never touched. |
| Scoring rule | Share of each note sung inside a band, octave folded, per-note windows, late credit capped. | Verdicts are immediate and a flat singer cannot be credited through the next note. |
| Widest band | 80 cents; then 65, 50, 35. | At 100 one held pitch satisfies two notes a whole tone apart. |
| The app's own sound | While scoring on a speaker only click and guide cues in rests play; cues are muted in the tracker. Chords and the doubled melody are on the guide track only. | A guide voice alone scores every note (measured); chords at half the voice's level cost a third of the notes (measured). |
| Skills where slower is not easier | A ladder of steps at a fixed tempo, with the unchanged rating rule on the step number. | Longer notes are harder and more tiring, so the Coach must never slow them down. |
| Song audio | Nothing stored. Charts are moved to the range and rendered when opened. | No storage growth and nothing to re-render when the range changes. |
| Song levels | Six: echo a line, echo two lines, whole tune, in tune, hold the long notes, performance. Speed is always 1. | Help is withdrawn and strictness rises; slowing a song makes phrases outlast the breath. |
| Untimed "find the note" | An unscored tool (lesson step and range page), not a second scored path. | TestFlow can only run the Player; one scored path keeps the Coach simple. |
| Release | Everything behind `voiceEnabled()` until the last package. | Each package can be released without showing half a voice side. |

Checked against the code before relying on it:

- `initialiseCourse(lessonIds, now)` already has a second parameter (src/lessons/store.ts:18, called from coach.ts:658, finish.ts:22, store.ts:245). The profile id is a third parameter.
- With `startTempo === targetTempo` any accurate run lifts the rating stop to 100 and adds at least one point (src/training/learner.ts:114-116). A fixed-tempo skill therefore needs the step axis, or it is mastered by round count on its easiest content.
- `isTestDue` returns `'monthly'` whenever 28 days have passed since `max(placementDoneAt, lastMonthlyAt)` (assessment.ts:300-308). Voice never sets `lastMonthlyAt`, so voice asks with `lastMonthlyAt: now`.
- `hasStaleAudio` falls through to `isStaleRender` for an unknown `builtinId` (src/songs/index.ts:125-130): voice rows must be skipped or they look stale at every launch.
- `songSummaries` runs `generateLevels` over every stored song (coach.ts:96); only `levelNoteCounts.length` is read anywhere (planner.ts:353, assessment.ts:288, recommend.ts:69).
- `MilestoneType` and `StepId` and `SkillCategory` each feed an exhaustive record (MilestoneList.tsx:5, lessonUtils.ts:15, skills.ts:455). No milestone type is added; the other two are extended in the package that owns the record.
- `ILLUSTRATION_LABELS` is an `as const` object, not a record over `IllustrationId`, so new ids compile before their drawings exist (unknown ids draw a placeholder).
- `addSong` needs an audio Blob (db.ts:111); vocal rows are written directly.
- The version 5 upgrade was run again in Node with fake-indexeddb: every row of all nine tables unchanged apart from the stamp, a voice session on the same date accepted, a second guitar session rejected, an unstamped row accepted and outside the compound index. Not run in Safari.

## 2. Instruments and stored data

### Types

`src/training/instruments.ts` (the name `Instrument` belongs to src/music/tunings.ts:3):

```ts
export type InstrumentId = 'guitar' | 'voice'
export const instrumentOf = (row: { instrument?: InstrumentId }): InstrumentId => row.instrument ?? 'guitar'
export const profileIdFor = (i: InstrumentId): 1 | 2 => (i === 'voice' ? 2 : 1)
export const instrumentOfSkillId = (id: string): InstrumentId => (id.startsWith('voice.') ? 'voice' : 'guitar')
export const instrumentOfLessonId = (id: string): InstrumentId => (/^v\d\d-/.test(id) ? 'voice' : 'guitar')
export const instrumentOfBlockId = (id: string): InstrumentId => (id.startsWith('voice-') ? 'voice' : 'guitar')
export function skillsFor(i: InstrumentId): SkillDef[]      // SKILLS | VOICE_SKILLS
export function skillById(id: string): SkillDef | undefined  // both lists
export function courseFor(i: InstrumentId): Lesson[]         // COURSE | VOICE_COURSE
export function activeInstrument(s: Pick<AppSettings, 'instrument'>): InstrumentId  // 'guitar' unless voiceEnabled() and s.instrument === 'voice'
```

`SKILLS`, `SKILLS_BY_ID`, `COURSE` and `BUILT_IN_SONGS` keep meaning guitar. Tests pin them (27 skills, ten lessons, twelve songs), the guitar simulation plays them with a recorded guitar, and `migrate.ts` only knows guitar ids, so voice states are never touched by guitar tempo corrections.

Additions to `src/training/types.ts`, all optional so stored guitar rows stay valid:

```ts
SkillCategory += 'pitch' | 'range' | 'breath'     // labels: 'Staying in tune', 'Higher and lower', 'Breath'
interface SkillStep { label: string; params: Record<string, unknown>; bonus: number }
SkillDef += { minTempo?: number; steps?: SkillStep[] }
SkillState += { step?: number }
AttemptResult += { voice?: { medianCents: number | null; topMissed: number } }
Profile: id: 1 | 2; instrument?: InstrumentId; voice?: VoiceProfile
interface VoiceRange { low: number; high: number; easy: number; measuredLow?: number; measuredHigh?: number;
  source: 'measured' | 'default' | 'manual'; at: number }           // MIDI numbers; low..high is the comfortable range
interface VoiceProfile { range?: VoiceRange; keyNudge?: Record<string, number>; tiredOn?: string }
instrument?: InstrumentId on SessionRecord, Attempt, TestRecord, Milestone, SongItemState
```

`src/db/db.ts`: `SongRecord.instrument?: InstrumentId`. `src/chart/types.ts`: `ChartNote.lyric?: string` and `Chart.voice?: VoiceChart` (section 5). `src/lessons/types.ts`: `Lesson.tool?: 'tuner' | 'range' | 'match'` and the voice illustration ids.

`src/app/settings.ts`: `instrument: InstrumentId` (default `'guitar'`, a per-device view choice) and `voiceHeadphones: boolean` (default `false`). The range lives on the voice profile because backups do not carry settings.

`src/app/features.ts`: `voiceEnabled() = VOICE_RELEASED || localStorage['gt.voice'] === '1'`, with `VOICE_RELEASED = false` until the last package.

### Version 5

```ts
db.version(5).stores({
  songs: '++id, title, artist, createdAt, updatedAt, builtinId',
  skillStates: 'skillId, rating, nextReviewAt',
  attempts: '++id, at, kind, skillId, songId, sessionId',
  sessions: '++id, date, &[instrument+date]',
  tests: '++id, at, type',
  songItems: 'key, songId, nextReviewAt',
  profile: 'id',
  milestones: '++id, &key, at, type, skillId',
  lessons: 'id, status',
}).upgrade((tx) => tx.table('sessions').toCollection().modify((s) => { if (s.instrument === undefined) s.instrument = 'guitar' }))
```

Only the sessions line differs from version 4. The plain `date` index stays because coach.ts orders sessions by date and e2e/student.mjs reads them by date. This is the first `.upgrade()` in the repo.

A row without the stamp sits outside the compound index. So `saveSession` always stamps (default guitar), import stamps, and `getSession(date, instrument = 'guitar')` reads `where('[instrument+date]').equals([instrument, date])` and falls back to `where('date').equals(date)` filtered by `instrumentOf`, re-stamping what it finds.

### Scoping, table by table

| Table | Guitar | Voice | Read |
|---|---|---|---|
| profile | row 1, untouched | row 2, created by the voice set-up | `loadProfile(i)`, `useProfile(i)`, `markSessionDay(date, i)` |
| sessions | stamped `'guitar'` | stamped `'voice'`, block ids `voice-${date}-${i}-${kind}` | `getSession(date, i)`, `useTodaySession(date, i)`; coach `planning` map keyed `${i}:${date}` |
| skillStates | guitar ids | ids `voice.*` | `loadLearnerModel(i)` keeps states whose id is in `skillsFor(i)` and song items of that instrument |
| lessons | `l01-…` | `v01-…` to `v10-…` | `courseProgress(ids?)`; `restartCourse(ids)` uses `bulkDelete(ids)`; `initialiseCourse(ids, now, profileId = 1)` |
| songs | no field | `instrument: 'voice'`, `builtinId: 'sing-…'`, no audio | `useSongs(i)`, `songSummaries(i)` filter by `instrumentOf` |
| songItems | key `${songId}:${level}` | same, stamped | filtered in `loadLearnerModel` |
| attempts, tests | no field | stamped | `recentAttempts({ instrument })`, `listTests(limit, i)` filter in memory before the limit |
| milestones | keys as stored | stamped; streak and test keys prefixed `voice:` (`voice:streak:7`) | `listMilestones(limit, i)`, `milestonesSince(ts, i)`; seen mark `gt.milestonesSeenAt.voice` |

Every new parameter defaults to `'guitar'`. `recentFocusSkillIds` and `recentRecapSkillIds` in coach.ts filter sessions by instrument.

### Backup, restore, reset

Export is version 2: the version 1 object (with `profile` = row 1) plus `profiles: Profile[]`. Import accepts 1 and 2. A version 1 file is a guitar backup: in one transaction it deletes guitar rows only (rows with `instrumentOf === 'guitar'`; skill states and lessons whose id is not a voice id; profile 1), stamps the imported sessions, and leaves every voice row. Because attempts, sessions, tests and milestones share `++id` tables with voice rows, a guitar-only import drops the ids stored in the file, lets the database give new ones, and rewrites each imported `Attempt.sessionId` to the new id of its session. The test for this uses a backup whose ids overlap voice rows already on the device. A version 2 file replaces both. `resetTrainingData(instrument?)` deletes one side by the same predicates, or everything. The Data card says the backup holds guitar and singing and offers the three resets. Known limit, unchanged: backups hold no songs; vocal rows are tiny and re-created by `installVocalSongs()`.

### Switch and routes

A two-segment control "Guitar | Singing" (`instrument-switch`, `instrument-guitar`, `instrument-voice`, `aria-pressed`) sits in AppLayout above the page on `/`, `/songs`, `/progress`, `/lessons` and under the brand on desktop, rendered only when `voiceEnabled()`. It only calls `updateSettings({ instrument })`. The phone bar keeps six tabs; with voice active the fourth is "My voice" at `/range`.

List pages read `activeInstrument(settings)`. Entity pages take the instrument from the entity: lesson id, block id prefix, song record. New routes: `range` in the shell, `/sing/:songId` full screen, `/start?instrument=voice`. `/play/:id` of a voice record redirects to `/sing/:id`. `BUSY_ROUTES` gains `/^#\/sing\//` and `/^#\/range($|[/?])/`. Manifest id, scope, database name and storage keys do not change.

## 3. Scoring singing

Files: `src/features/play/runTracker.ts` (seam), `src/features/play/voice/judge.ts` (constants), `voiceEar.ts` (frame rule, shared with the range finder), `voiceTracker.ts`, `simulateVoice.ts`. `scoring.ts` and `scoreFrame.ts` are untouched.

### Seam

```ts
export interface RunTracker {
  readonly needsSpectrum: boolean
  setSpeed(s: number): void; reset(): void; seek(t: number): void; setRange(from: number, to: number): void
  nextPass(): void; markUnscored(): void; advance(t: number): unknown[]; onPlaybackStart(): void
  frame(frame: PitchFrame, songTime: number | null, settings: FrameSettings): FrameOutcome
  stateOfNote(noteId: number): Pick<GroupState, 'status' | 'judgement'> | undefined
  progressOf?(noteId: number): NoteProgress | undefined
  ownSoundHeard?(): boolean
  summary(): ScoreSummary
  toAttemptResult(o: { playedTempo: number; targetTempo: number; speed: number; durationSec: number }): AttemptResult
}
export function createRunTracker(chart: Chart, notes: ChartNote[], o: { octaveTolerance: OctaveTolerance; a4: number; sampleRate: number }): RunTracker
```

`createRunTracker` returns a `VoiceTracker` when `chart.voice` is set, otherwise `guitarRunTracker`, a wrapper around `ScoreTracker` plus `PitchSmoother` whose `frame()` is today's `scoreFrame` call. Player.tsx changes: line 243 (factory), 268 (`createLaneRenderer(chart, canvas)`), 359 (the draw object also carries `chart` and `progressOf`), 406 (`tracker.frame`), 425 (spectrum on only when `needsSpectrum`), after the microphone step of every start `audioEngine.configureDetector(...)` for a voice chart, 111 (guide starts on for a voice chart only when `settings.voiceHeadphones`), finish (`if (guideRef.current && tracker.ownSoundHeard?.()) bleed`), and the guide and notice strings from `playerLabels.ts`. `simulate.ts`: the loop of `scoreHeard` becomes `runHeard(tracker, heard, durationSec, options)`; `scoreHeard` keeps its signature and numbers.

Detector for a voice run: `minFreq = max(60, hz(low - 14))`, `maxFreq = min(1200, hz(high + 14))`, threshold 0.9, spectrum off. `settings.clarityThreshold` and `octaveTolerance` are not read.

### Constants (`VOICE` in judge.ts; seconds, never frames)

| Name | Value | Why |
|---|---|---|
| clarity | 0.6 | noise alone measured at most 0.59; quiet or breathy singing 0.73 to 0.82 |
| minRms, floorFactor | 0.004; 3 x the 20th-percentile level heard in the count-in, gate capped at 0.02 | room floor |
| windowCentre | 1024 / sampleRate | the detector reports the pitch of the window centre |
| early | 0.10 s | a note begun a little early |
| late | min(0.25 s, 0.35 x judged length) | lateness is not wrong pitch; the cap keeps credit from the next note under any hit share |
| onsetSkip | min(0.12 s, 0.3 x note) | scoops and consonants |
| release | min(0.06 s, 0.15 x note) | the end of a note is never required |
| vibratoMean | 0.17 s, at least 0.09 s voiced, every frame within 150 cents | a swing of 5 to 7 a second averages out, a steady offset does not |
| slip | one frame over 900 cents from both neighbours is dropped | detector slips |
| shortNote | under 0.25 s: a hit needs 0.08 s in tune | quick notes |
| perfect | share >= 0.8 and median error within `max(25, 0.6 x band)` cents: 48, 39, 30, 25 for the four bands | the Coach counts a good as 0.8, so a singer comfortably inside the band must be able to earn a clean round (0.85) |
| silentShare | 0.25 | below it the note was not heard |
| cueGuard | 0.05 s before, 0.30 s after | the app's own cue and its tail |
| ownSound | 0.15 s of voiced frames within 60 folded cents of the intro cue, the first within 0.15 s of the cue's start | a speaker is on time; a person humming along starts later |

### Rule

1. A frame is voiced when `freq > 0`, `clarity >= 0.6` and `rms >= gate`. Its time is the Player's latency-compensated song time minus `windowCentre`.
2. Octave: `cents = 1200 * log2(freq / target)`, `folded = cents - 1200 * round(cents / 1200)`. Any octave counts; the unfolded octave is kept for the line "You sang it an octave lower. That counts."
3. In tune: `|folded| <= band`, or the mean folded error over `vibratoMean` is within the band.
4. A frame inside `[cue.time - 0.05, cue.end + 0.30]` of any entry of `chart.voice.cues` is dropped: no credit, no coverage.
5. Each in-tune frame is credited to at most one note: the note whose written span holds it, else the previous note if the frame is inside that note's late window and in tune with it, else the next note if inside its early window. Late credit per note is capped at `late`.
6. Per note: `judged = max(0.08, duration - onsetSkip - release)`; `share = min(1, inTuneSeconds / judged)`. Hit when `share >= judge.minShare` (0.5 or 0.6, never lower). Perfect as above, else good. With `judge.sustain`, a note of one beat or more whose last in-tune frame is more than 0.25 s before its written end is at most good. A note is settled when song time passes its end + 0.25 s.
7. Reasons kept per note for feedback, not for the score: `silent`, `low` or `high` (median outside the band, with the distance in whole notes), `unsteady` (median inside, share too low), `slid` (first 0.2 s more than 100 cents under, then on the note).

### Results

`summary()` is the existing `ScoreSummary`. `toAttemptResult()`: perfects, goods, misses, total per note; `coverage` = share of scored notes voiced for at least 25 % of their judged length; `perBar` from note results; `timingMedianMs` = median of (first in-tune frame minus note start) with 8 or more hits, else null; `timingStdevMs` always null; `voice.medianCents`; `voice.topMissed` = misses with reason low or silent among notes in the top 3 semitones of the piece.

Consequences in unchanged code: `attemptPerformance` uses accuracy for the timing part; `meetsCriteria` passes when the median is within the task's limit; `runVerdict` gives `unscored` for a silent run (no hits, coverage under 0.2). Voice test tasks carry `{ minAccuracy: 0.8, maxMedianMs: 250, maxStdevMs: 10000 }`.

## 4. The app's own sound

Measured through the real analyser: chords alone never produce a confident pitch; a voice with chords at half its level loses about a third of its notes; a guide voice alone scores every note in any octave. So:

- **Scored track** (Player `audio`, `backingIsClick` true): click plus the cues in `chart.voice.cues`. Cues are the starting note in the intro bar and the guide's turns in echo forms. Builders guarantee at least one beat between the end of a cue and the next scored note; a test checks every song, level and generator. Rule 4 mutes them.
- **Guide track** (Player `guideAudio`): click, cues, the scored notes sung by the guide voice (levels 1 to 4 and all exercises), and for songs the strummed chords. Used by Listen first, and while scoring only when the guide is on.
- **Guide on** is for headphones. It starts on when `settings.voiceHeadphones` is true (asked in set-up, changed in Settings). The existing count-in rule then applies unchanged: clicks heard through the microphone mean bleed, the run is not counted. Second proof: `ownSoundHeard()`. When either fires on a voice run, the notice reads "The microphone is hearing the speaker, so this run will not count. Use headphones, or turn the guide off." and `voiceHeadphones` is set back to false.
- Echo cancellation stays a user option and changes nothing here.

On a bare phone the learner therefore sings to a click and a starting note. That is bare, and it is the only arrangement that cannot score itself.

## 5. Range, key and songs

### Finding the range

`src/features/voice/rangeFinder.ts` (pure) and `RangeFinder.tsx` with the GuidedTuner contract `{ onDone, onSkip, autoStart }`; microphone by `claimMic` / `releaseMic` (the detector is set back to 55 to 1500 Hz before release); frames through `voiceEar`. Used in the wizard, lesson 1 and `/range`. Under a minute, every step skippable, each with "Stop while it is easy. This is not a test of how high you can go."

1. "Hum any note that feels easy" (4 s, needs 1.5 s voiced): `easy` = rounded median; hum level kept.
2. "Slide down gently, like a sigh, and stop when it starts to croak", twice: `measuredLow` = lowest pitch held 0.3 s at half the hum level or more. `low = measuredLow + 2`.
3. "Slide up quietly, like a small siren", twice: `measuredHigh` = highest pitch held 0.3 s at no more than twice the hum level. `high = measuredHigh - 3`.
4. If `high - low < 7`, `measuredLow < 36` or `measuredHigh > 86`: `low = easy - 3`, `high = easy + 4`, source `'default'`, said plainly. A span over 14 is cut to 14 around `easy`. The smallest range the app ever stores is 7 semitones (eight notes, a five-note scale with room to spare), and step 0 of every skill and every lesson drill is tested to build inside both default ranges and this fallback.

Skipped or no microphone: two buttons, "Lower voice" (48 to 55, easy 52) and "Higher voice" (60 to 67, easy 64), each playing its note. The app never infers anything from sex. The result screen "Your easy notes" has "a bit lower" and "a bit higher" (one semitone, source `'manual'`). The range is never widened automatically. "Tight" after a slides round lowers `high` by one, never under `low + 7`.

### Key

`src/music/keys.ts`:

```ts
chooseKey(span: { low: number; high: number; centre: number }, range: VoiceRange, nudge = 0): { shift: number; fits: boolean }
placePattern(offsets: number[], range: VoiceRange, seed: number): number[]   // home notes for the keys of one round
```

A song is written in semitones above a home note at MIDI 60. Candidates are the shifts with `low + shift >= range.low` and `high + shift <= range.high`. `VoiceRange.low` and `VoiceRange.high` are both inclusive: every note the app ever asks for satisfies `low <= midi <= high`. The headroom is already taken by the range finder (two semitones above the lowest note found, three below the highest). Choose the one whose length-weighted centre is nearest the middle of the range; within one semitone prefer a home note of C, D, E, G or A; then the lower. No candidate: `fits` is false, the song is listed under "Comes later", and the Coach never offers it. `nudge` is `profile.voice.keyNudge[builtinId]`, -3 to +3, clamped so the song still fits; "Lower" and "Higher" on the song page change it. Two counted plays in a row with `voice.topMissed >= 2` lower it by one before the level ladder may step back: "That one sat high for you, so we moved the song down a little."

`placePattern` puts the pattern's middle on `easy`, moves up a semitone per repetition while the top stays at or under `high`, then comes back. A pattern wider than the range uses its narrower form (1-3-5 instead of 1-3-5-8 under 13 semitones).

### A song as data

`src/songs/vocal/`:

```ts
type VocalStep = [semitonesAboveHome: number | null, beats: number, syllable?: string]   // null = rest
type Degree = 'I' | 'IV' | 'V' | 'V7' | 'vi' | 'ii'
interface VocalSong { id: `sing-${string}`; title: string; credit: string; description: string; bpm: number;
  beatsPerBar: 3 | 4; pickupBeats: number; lines: VocalStep[][]; chords: Degree[]; lessonLevel: number; needs?: string[] }
```

Syllables: one per note, a trailing hyphen when the word goes on, `''` for a held syllable. `VOCAL_SONGS` is its own list, never appended to `BUILT_IN_SONGS`.

```ts
interface VoiceCue { time: number; duration: number; midi: number; lyric?: string }
interface VoiceJudge { band: 80 | 65 | 50 | 35; minShare: 0.5 | 0.6; sustain?: boolean }
interface VoiceChart { judge: VoiceJudge; cues: VoiceCue[]; low: number; high: number; tonic: number; shift: number;
  lineStarts: number[]; hideAnswers?: boolean; glide?: boolean }
```

`arrange(song, { shift, level }): Chart` builds notes on `constantBeatGrid`: `midi = 60 + offset + shift`, string 0, fret 0, own `chordId`, `lyric`, standard `tuning`, capo 0, so guitar-typed code stays valid. Every arrangement opens with an intro bar: the first sung note as a cue from beat 0 for `min(2, beatsPerBar - pickupBeats - 1)` beats, at least one silent beat, then the tune (a pickup sits at the end of the intro). The last note of each line is shortened so at least 0.4 s of rest follows; a breath mark is drawn there. `accompanimentChart(song, shift, level)` uses the same grid with strums on beat 1 (and 3 in 4/4), open shapes and a capo of 0 to 2: C=C+0, C#=C+1, D=D+0, D#=D+1, E=E+0, F=E+1, F#=E+2, G=G+0, G#=G+1, A=A+0, A#=A+1, B=A+2.

### Levels (index 0 to 5 = `SongItemState.level`)

| Index | Name | Form | Shown | Band | Share | Guide track |
|---|---|---|---|---|---|---|
| 0 | Echo each line | the guide sings a line (cue), you answer it over clicks | la | 80 | 0.5 | doubles your line |
| 1 | Echo two lines | the same, two lines at a time | la | 80 | 0.5 | doubles |
| 2 | Whole tune | straight through, starting note only | words | 65 | 0.5 | doubles |
| 3 | In tune | as 2 | words | 50 | 0.5 | doubles |
| 4 | Hold the long notes | as 2, sustain on | words | 50 | 0.6 | chords and starting note only |
| 5 | Performance | as 2, sustain on | words | 35 | 0.6 | chords and starting note only |

Every level scores the same notes, so `levelNoteCounts` has six equal entries. The existing ladder applies with a speed list of `[1]`: up at 0.9, back after two runs under 0.7, weak bars looped first (bar numbers include the intro). `songLevelDifficulty` (30 + 10 x index) is kept. A beginner's first song starts at index 0; a singer with no history at index 2.

### Stored and played

`installVocalSongs()` writes one light row per song: `instrument: 'voice'`, `source: 'builtin'`, `builtinId`, `builtinRev = vocalRevision(song)` (its own hash of the spec; `contentRevision` is not changed), `chart = arrange(song, { shift: 0, level: 2 })`, no `audioData`, `audioName: '${id}.voice'`. `hasStaleAudio` and the refresh loop return early for voice rows.

`useVocalRun(record, level)` (src/songs/vocal/useVocalRun.ts) returns `{ chart, notes, audio, guide, shift }`: the arrangement for the current range and nudge; the scored track (click from `renderDrums` plus cues from `renderVoiceNotes`), synchronous; the guide track, set once the chords have come back from the existing worker job (`renderChartVoiced`), and falling back to voice and click alone if that fails. The last three results are cached in memory by `${id}:${rev}:${shift}:${level}:${VOICE_SYNTH_VERSION}`.

`songSummaries('voice')` takes `lessonLevel` from `VOCAL_SONGS` and leaves out songs that do not fit the range or whose `needs` skills are under 50.

First songs (span in semitones; available after lesson): sing-hot-cross-buns (4; 4), sing-mary-lamb (7; 5), sing-ode-to-joy with "Joyful, joyful" (7; 6), sing-aunt-rhody (7; 7), sing-saints (7; 8), sing-london-bridge (9; 8), sing-jingle-bells chorus (7; 9), sing-twinkle (9; 9), sing-amazing-grace (12; after the course), sing-happy-birthday (12; after the course). Every melody, syllable split and chord row is written by hand and checked against a score before bundling. Course songs have a span of 7 or less, so they fit the default range.

## 6. Skills, exercises and the Coach

### Skills (`src/training/voiceSkills.ts`)

T = tempo skill (ref / start / target / min bpm). S = step skill at a fixed tempo (ref = start = target = min).

| Id | Name | Tier | Needs | Category | Pace | Generator |
|---|---|---|---|---|---|---|
| voice.pitch.match | Match a note | 0 | none | pitch | S 60 | voiceEcho |
| voice.pitch.steps | Step up and down | 1 | match | pitch | T 66/60/88/54, quarters | voicePattern |
| voice.pitch.five-note | Five notes up and back | 1 | steps | pitch | T 66/60/96/54, eighths | voicePattern |
| voice.pitch.hold | Hold a note steady | 1 | match | breath | S 60 | voiceHold |
| voice.range.slides | Slides | 1 | match | range | S 60 | voiceSlide |
| voice.pitch.echo | Echo a short tune | 1 | match | pitch | S 72 | voiceEcho |
| voice.interval.thirds | Small jumps | 2 | five-note | range | T 66/56/92/50, eighths | voicePattern |
| voice.interval.triad | Chord notes up to the top | 2 | thirds, slides | range | T 72/60/92/60, quarters | voicePattern |
| voice.breath.phrases | A whole line on one breath | 2 | hold, five-note | breath | S 72 | voicePattern |
| voice.interval.leaps | Bigger jumps | 3 | triad | range | S 66 | voicePattern |
| voice.pitch.runs | Quick notes | 3 | five-note, thirds | pitch | T 100/100/132/92, eighths (at most 4.4 notes a second) | voicePattern |
| voice.pitch.alone | Stay in tune on your own | 4 | hold, leaps | pitch | S 60 | voiceEcho |

Step ladders (label; band; bonus):

- match: 4 notes within 2 semitones of the easy note, held 3 beats; 80; 0 | 4 notes within 4 semitones; 65; 12 | 6 notes over the whole range; 50; 20 | the same with a one-beat cue; 35; 28.
- hold (sustain on): notes 1, 3, 5 for 4 beats; 65; 0 | 6 beats; 50; 8 | 8 beats; 50; 16 | 8 beats; 35; 24.
- slides (anchor notes home, top, home; the glide between is drawn, not scored; a crack is information): to the third; 80; 0 | to the fifth; 80; 8 | to the octave, needs 13 semitones of range; 65; 16.
- echo (answers hidden until judged): 3 notes from 1-2-3; 80; 0 | 4 notes with 5; 65; 8 | 5 notes with a jump; 50; 16.
- phrases: five-note scale once; 65; 0 | twice without a breath; 50; 8 | twice, last note held 4 beats (10 s, the cap); 50; 16.
- leaps: up to a fourth; 65; 0 | fifth; 50; 6 | sixth; 50; 12 | octave; 50; 18.
- alone (one cue, then clicks only): scale; 50; 0 | scale, two silent bars, home again; 50; 10 | the same; 35; 20.

Left out of this release on purpose: a rhythm skill (the tracker reports no onset spread), a scored hum and a breath-flow skill (no pitch, level is weak evidence), finding the note from chords (no chords under exercises), louder and softer, a wider-range skill.

### Generators (`src/training/exercises/voice/`, registered in `GENERATORS`)

`voiceEcho`, `voiceHold`, `voicePattern`, `voiceSlide`, built with `VoiceBuilder` (`note(beat, beats, midi, lyric)`, `cue(beat, beats, midi)`, `build(judge, range)`). Each returns id `${ID}:${hashParams(params)}`, interaction `'highway'`, `backing: null`, and honours `params.tempo`, `bars`, `seed`, `low`, `high`, `easy`, `step`. All are call and response: bar A the guide sings (cues), bar B the learner answers over clicks. Skills of tier 2 and up get only the first note as the call. Every note is inside `low … high`, both inclusive. At least two beats of rest follow each answer. No unbroken singing over 8 s in tiers 0 and 1, 10 s above, checked at `minTempo`. A generator id that starts with `voice` and is not registered throws; it never falls back to the guitar `melody`.

Sound: `renderExerciseBacking` and `renderExerciseGuide` branch on `chart.voice`: scored track = click + cues; guide = the same plus the answers sung. No chords under exercises.

The range reaches a generator at build time, never from the stored block: `exerciseForBlock(block, tuning, range?)`, `exerciseForTask(task, tuning, range?)`, `lessonDrillExercise(lesson, tuning, range?)` fill `low`, `high`, `easy` from the voice profile, so a range made smaller mid-day is honoured at once and the values are in `Attempt.params`.

### How each Coach rule applies

Planner options for voice (all optional `PlannerInput` fields with today's values as defaults):

| Option | Guitar default | Voice |
|---|---|---|
| `idPrefix` | `''` | `'voice-'` |
| `warmupCategories` | fretting, picking, timing | pitch, range |
| `maxBars` (in `fitRounds`) | 32 | 8 |
| `templates` (warm-up, main, second, song, recap) | `SESSION_TEMPLATES` | 10: 2/4/0/4/0; 20: 3/6/0/7/4; 30 and 45: 3/7/5/10/5 |
| `songSpeeds` | 0.75, 0.85, 1 | 1 |
| `excludeCategories` | none | range, on the day after "My voice is tired" (with the 10-minute template) |
| `copy` | the four guitar sentences | "First steps: easy notes in the middle of your voice before anything else.", "Another exercise, to use your voice in a new way", "An easy first exercise to wake your voice up gently" |

Voice offers 10, 20 or 30 minutes; the 5-minute quick session is not shown (a voice day always opens with a warm-up).

**Tempo skills** keep every rule as written: start at ceiling x 1.05 or `startTempo`; +5 % after accuracy >= 0.85 (at most 15 % in a session); -8 % under 0.75; -5 % after two in-between rounds; never above `targetTempo`; difficulty by tempo; rating stop 75 at the start tempo, 89 just under the target, 100 only by an accurate run at the target. One guard: `SkillDef.minTempo`. `makeExercise` stores `params.minTempo` when the skill has one (guitar blocks stay byte-identical) and clamps; `nextRepTempo(…, minTempo = MIN_TEMPO)`, `adaptAfterBlock`, the warm-up 0.9, the comeback 0.9, the day factor and the review tempo all go through the same clamp. At the floor a rough round is repeated at the floor with "Listen first, then once more".

**Step skills** never change tempo. A ladder replaces it, rule for rule:

| Tempo rule | Step rule |
|---|---|
| start tempo | `params.step = min(state.step ?? 0, maxStepFor(skill, range))`; `params.startStep` is the same |
| warm-up at 0.9 x; comeback at 0.9 x | one step easier (never under 0) |
| item difficulty by tempo | `itemDifficulty(skill, { tempo: refTempo, bonus: steps[step].bonus })` |
| +5 % after a clean round, 15 % cap | `nextRepStep`: accuracy >= 0.85 gives step + 1, at most one above `startStep` |
| -8 % after a rough round | accuracy < 0.75 gives step - 1 (easier, never slower) |
| tempo ceiling | `state.step`: after a counted, reliable run at step s with accuracy >= 0.85, when the last 10 attempts in 30 days hold another such run at s or above, `step = max(step, min(s + 1, last))`; three counted runs in a row under 0.6 at the current step or below give `step - 1`. A warm-up can raise it, never lower it. |
| rating stop 75 / 89 / 100 | `applyAttempt` calls the unchanged `ratingDelta` with `{ start: 0, target: steps.length - 1 }`, the run's `playedTempo` set to its `params.step` and the state's ceiling set to `max(0, step - 1)`. So a gain stops at difficulty + 40, at 75 on step 0 rising to 89 on the last step, and reaches 100 only by an accurate run on the last step, with the same minimum of one point. |

Worked caps: match 50, 62, 70, then 100; hold 60, 68, 76, then 100; phrases 75, 82, then 100. `RepOutcome` gains `nextParams?: { step: number }`; the block runner merges it as it merges the next tempo. A step reached for the first time is a milestone of type `tempo` with key `step:${skill.id}:${n}` and title `${skill.name}: ${label}`; the "clean at N bpm" milestone is not raised for step skills. Round cards say the step label ("Next round: 6 beats", "Next round a step easier").

**Checks.** No starting check: the voice set-up sets `placementDoneAt` for every answer. The weekly check is the generic `checkpointTasks` over voice skills, built at each skill's current step with the voice pass criteria; it is asked for with `isTestDue({ ...profile, lastMonthlyAt: now }, now, 0)`, so it never depends on the sound-sync measurement and a monthly check is never due. `attemptPerformance` gets calibration age 0 for voice; TestFlow skips its calibration gate.

**Stamps and keys.** Voice attempts, tests, song items and milestones are stamped in coach.ts; streak and test milestone keys get the `voice:` prefix there. Unknown skill ids throw; the fallback to `SKILLS[0]` is gone.

**Tired.** "My voice is tired" skips the remaining blocks without penalty and sets `profile.voice.tiredOn`; the next day uses the 10-minute template with no range skills.

## 7. First steps for singing

`VOICE_COURSE` (src/lessons/voiceCourse.ts), ten lessons of 4 to 6 minutes in the existing `Lesson` shape. Drills are the generators' own exercises with the lesson's params and the stored range (id `lesson:${lesson.id}`), so the lesson, the daily plan and the simulation sing the same thing. Every drill: 3 rounds, pass at 0.7, the learner can always continue. Plays are `{ songId, level, speed: 1, view: 'outline' }`. A lesson with `tool` and no drill runs the tool where the guitar course runs the tuner, and marks `drillDone` the same way. Course helpers (`lessonById`, `nextLessonAfter`, `nextAvailableLesson`, `unlockedSongIds`, `taughtSkillIds`, `finishedLessons`, `courseEntry`) take a course defaulting to `COURSE`; `finishLesson` finds the course from the lesson id and ends it on that instrument's profile.

| Lesson | Cards | Middle step | Song | Unlocks |
|---|---|---|---|---|
| v01-voice Meet your voice | singing is speaking held longer (voice-posture); you and your phone (voice-phone); it should never hurt | tool: range finder | none | |
| v02-meet Meet the note | listen, hear it inside, then sing; under or over the note (pitch-ladder); higher or lower voice, same note | tool: match (hear a note, slide until your dot meets the bar; three notes; nothing is scored) | none | |
| v03-match Match a note | reading the screen (voice-lanes); my turn, your turn; breathe in the gap | voice.pitch.match, step 0, 60 | Hot Cross Buns, level 0 | |
| v04-steps Step up, step down | next-door notes 1, 2, 3; keep the air going on the way down | voice.pitch.steps, 1-2-3-2-1, 60 | Hot Cross Buns, level 1 | sing-hot-cross-buns |
| v05-words Sing the words | the vowel carries the note (voice-mouth); breathe at the marks; every line has its starting note | voice.pitch.echo, step 0, 72 | Hot Cross Buns, level 2 | sing-mary-lamb |
| v06-five Five notes | up five and back; the top note is lighter, not louder; one small step higher each time, then back down | voice.pitch.five-note, 60 | Mary Had a Little Lamb, level 0 | sing-ode-to-joy |
| v07-hold Hold it steady | breathe low and quiet (voice-breath); steady air, not more air; if you feel dizzy, stop and breathe normally | voice.pitch.hold, step 0 | Mary Had a Little Lamb, level 2 | sing-aunt-rhody |
| v08-jumps Small jumps | skipping a note; hear the landing note first; no sliding up to it | voice.interval.thirds, 1-3-5-3-1, 56 | Ode to Joy, level 1 | sing-saints, sing-london-bridge |
| v09-slides Sliding higher, staying easy | the slide (voice-slide); cracks are normal and do no harm; stop while it is easy | voice.range.slides, step 0, then "Easy, OK or Tight?" | When the Saints, level 1 | sing-jingle-bells, sing-twinkle |
| v10-song Your first whole song | one note to start, then it is yours; headphones let you hear the guitar; what daily practice looks like | voice.pitch.match, step 1 | the goal song (Ode to Joy, Saints or Mary; Ode to Joy when none), level 2 | course done |

Lesson 4 drills a tier 1 skill, which ends beginner mode for a graduate, as on guitar.

Illustrations (each ignores handedness; one fixed aria-label): voice-posture, voice-breath, voice-phone, voice-mouth, pitch-ladder, voice-lanes, voice-slide.

Course test: ten lessons with ids v01 to v10; 2 to 4 cards; paragraphs under 220 characters; mistakes match `/^If .* then /`; every skill, generator and song exists; course songs span 7 or less; banned words: bpm, rating, accuracy, rep, tier, push, belt, louder, "as loud", tone deaf, wrong, failed; no `{left}` or `{right}`.

## 8. Screens

- **Set-up** (`/start?instrument=voice`, root `data-instrument`): welcome "Have you sung before?" with the same three buttons and test ids; time (10, 20, 30); song; phone ("Stand or sit about a forearm from the phone, in a quiet room." "Are you wearing headphones?" sets `voiceHeadphones`; mic check "Say or hum anything and watch the bar move."); range; finish ("New to singing · easy notes G3 to D4 · 10 min a day"). The first screen has "Not now, back to guitar", which sets the switch back and writes nothing. Finish calls `startFirstSteps(setup, 'voice')`: profile 2, voice lesson rows, `installVocalSongs()`; it never writes handedness or guitar type. "Yes, often" also sets `firstStepsDoneAt`. The guitar wizard is unchanged; `stepOrder(hasSongs, experience, instrument = 'guitar')`.
- **My voice** (`/range`): the pitch ladder with the easy notes shaded and a live dot ("see your note"), "Find my range again", "a bit lower", "a bit higher". Always visible: "Singing should never hurt. If your throat feels sore, scratchy or tired, stop for today."
- **Pitch lanes** (`src/features/play/voice/VoiceLanes.ts`, same `resize` / `draw` / `width` surface as `HighwayRenderer`; Highway.ts untouched; canvas keeps test id `highway`): height is pitch from `low - 2` to `high + 2`; each note is a bar as long as it lasts, moving right to left to the same line; the syllable, "la" or the note's number on the bar; a breath mark before each line; cues are hollow bars under "Listen", answers solid under "Your turn"; the live dot on the line, unrounded and folded into the visible octave, with a 1.5 s trail; the part of a bar sung in tune fills in; a missed bar gets a small arrow up or down. The corner shows "N of M notes", no multiplier.
- **Results**: the shared cards. "You were on the note for N of M notes." One tip from the reasons: "We could not hear you there. Move the phone a little closer." / "A little under the note. Think a bit higher and try again." / "A little over the note. Sing softer and let it settle." / "You slid up to the notes. Hear the note first, then start right on it." / "You sang it an octave lower. That counts." Never "sing louder", never "wrong". Not counted: "The app could not hear you sing. Check that the microphone is on and move the phone a little closer. This run was not saved." and "The phone was hearing its own sound. Use headphones or turn the guide off. This run was not saved."
- **Song page** (`/sing/:songId`, new `SingPage`; reuses Player, NotCountedCard, the loop helpers): "In your key", six named levels with best results, Listen first, Lower / Higher, loop a line. Saves through `recordSongPlay`.
- **Today**: the same four-way gate on the voice profile; course home tools "Find my easy notes · All lessons and songs"; plan rows, milestones and recommendations fed with voice data; "My voice is tired"; "Have some water nearby." under the first block; minutes 10 / 20 / 30. The block runner finds its session from the block id prefix.
- **Lessons, progress, checks, library, settings**: the shared pages with the instrument's course, skills, attempts, tests and songs. The skill map derives its categories from the skill list. The voice library hides import and demo buttons and shows key, levels and "Comes later". Settings gets a "Singing" card (easy notes, find them again, "I use headphones").
- **Name**: "Guitar Trainer" stays; descriptions say "guitar and singing".

## 9. Proof without a singer

- `src/audio/voice.ts`: `renderVoiceNotes(notes, { sampleRate })`, the guide voice: additive harmonics, 40 ms attack, 50 ms release, an added octave when the fundamental is under 110 Hz, deterministic.
- `src/features/play/voice/virtualSinger.testutil.ts`: `sing(notes, { sampleRate, cents, octave, scoopCents, scoopSec, vibratoCents, vibratoHz, lateSec, gapSec, breath, level, monotoneMidi, driftCentsPerSec })`, a different model on purpose (pulse train through three vowel formants, 0.5 % jitter, breath noise, consonant gaps), so the proof does not rest on the app's own timbre. Combined with `phoneMic`, `mix`, `delayed`, `clickTrack` and the app's real rendered tracks.
- `simulateVoice(chart, notes, mic, options)` = `analyseMic(mic, { detector: { pitch: true, minFreq, maxFreq } })` then `runHeard` with a `VoiceTracker`. Every case at 44100 and 48000 through `phoneMic`.

Must score (Coach accuracy at least 0.85, read from `attemptPerformance(result).acc`, never from `summary.accuracy`): in tune; an octave down; an octave up; 30 cents flat at bands 80 and 65 (perfects); 60 cents flat at band 80 (hits, all goods, Coach accuracy 0.8: counted, not clean); scoop of 200 cents over 150 ms; vibrato of 50 and 80 cents at 6 Hz; 150 ms late; 80 ms early; 100 ms consonant gaps; legato; quiet and breathy; voice over the click at equal level; latency 60 and 250 ms with the setting matched; two loop passes.

Must not score: silence, room noise, click alone (0 hits, verdict unscored); the scored track alone, also with the latency setting wrong by 250 ms (0 hits); chords alone (0 hits); the guide track alone with the guide on (`ownSoundHeard` true, bleed); 60 cents flat at band 50; 120 cents flat at band 80 on eighth notes at 100 bpm (the late-credit case; 0 hits); a third too high; one hummed note through every song and level (accuracy under 0.5); holding the first note of an echo call into the answer.

Kept as the written reason for the speaker policy: the guide voice alone, unmuted, scores every note.

Content sweep: the singer sings every skill's exercise at every step, every lesson drill and lesson song, and every song at levels 0, 2 and 5 in a low and a high range; in tune counts with Coach accuracy at least 0.85, 150 cents flat fails, the scored track alone scores nothing. A pure builder test asserts for every song, level and generator that no cue ends less than one beat before a scored note.

Browser: `e2e/singer.mjs` on the virtual microphone moved to `e2e/lib/virtualMic.mjs` (student.mjs imports it). Fixtures from `src/features/play/voice/e2eVoiceFixtures.test.ts` under `E2E_FIXTURES`: for lesson 3's drill, Hot Cross Buns level 0 and one planned block, a take in tune an octave below the lanes, a take 150 cents flat, and silence. Asserts: voice attempts stamped with accuracy at least 0.85 for the in-tune take; the flat take counted and weak; `no-score` with `data-verdict="unscored"` for silence; a voice session beside the guitar one on the same date; guitar profile, session and skill states unchanged.

Stated limit: the singer is a model. Vocal fry, breaks into the light voice, subharmonics and children's voices are not covered. Folding absorbs octave jumps; dropouts cost share. The clarity gate and the shares may need retuning from real recordings.

## 10. Voice care built in

Comfortable range only: nothing is ever asked outside `low … high` (inclusive). Never louder: when the app cannot hear, it says move the phone closer. Every session opens with a warm-up; rests are built into every exercise; rounds are at most 8 bars; holds at most 8 s, lines at most 10 s. A stop line on Today and the range screens; "My voice is tired" ends the day without penalty. "Tight" always wins over the numbers. Cracks are shown as information, never as a miss. No word of the copy says tone deaf, wrong, push or belt. The app is a practice helper, not a voice doctor; it says so once.

## 11. Device checks for the owner

1. Export a backup, then update over real version 4 data: Today, songs, lessons, progress and yesterday's session unchanged; a guitar and a singing session can both exist on one day.
2. With `localStorage['gt.voice'] = '1'`: stay silent through a voice exercise on the bare speaker at normal volume. Expected: "Nothing was scored". No bar may fill.
3. The same with the guide on and no headphones: the bleed notice must appear and the run must not count.
4. Sing Hot Cross Buns at levels 0 and 3 on the bare speaker, a forearm away, in a quiet room and with a TV on: do hits and "could not hear you" match what was sung? Repeat very softly and deliberately flat.
5. A low voice singing lanes set for a high voice and the reverse: notes count, the dot stays inside the lanes.
6. Wired headphones with the guide on: chords and melody audible, no bleed notice, notes scored; which microphone iOS uses.
7. AirPods: does opening the microphone switch to call quality, how late do notes land, is the result usable?
8. Is the starting note audible from the phone speaker for a low voice (around A2 to E3)?
9. Range finder with a real voice: plausible edges, the croak ignored, the screen stays awake, under a minute, "Skip" leads to a singable default.
10. Echo cancellation on and off while holding a 6-second note and while humming softly.
11. Pitch lanes on a small iPhone, portrait and landscape: syllables readable, dot smooth, safe areas respected; the switch clear of the notch; six tabs still fit.
12. Time to open a song level (the guide track arriving) on the oldest phone available.
13. A phone call, Siri or lock screen during a sung run: paused or partial, never saved as misses.
14. After a voice screen the guitar tuner still reads the low E and the high E.
15. A full guitar lesson, Today block and song behave as before.

## 12. Review amendments

A review of this design against the code found gaps. The three that would have shipped broken are already corrected in the text above (the "perfect" rule, the inclusive range, ids on a guitar-only import). The rest are settled here, and where a rule below differs from a section above, the rule below is the one to build.

### Storage and scoping

1. **Session stamp ships with the schema.** The package that changes the schema also makes `saveSession` stamp every row, so no session is ever saved outside the compound index. `saveSession` takes the instrument from the record, else from the block id prefix, and throws when the two disagree. The fallback read by plain date never throws: if it finds an unstamped row beside a stamped one for the same day it returns the stamped row and leaves the other alone. A later schema fallback, if Safari ever needs one, is version 6, never a redefinition of version 5.
2. **One predicate.** Loading, import and reset all decide the instrument of a skill state with `instrumentOfSkillId`, of a lesson with `instrumentOfLessonId`, of everything else with `instrumentOf`. A guitar state with a retired id is still a guitar state.
3. **Songs install on demand.** `vocalSongRecord(id)` returns the stored row and writes it first when it is missing (matching by `builtinId`, so the row id never changes). Lessons, plan blocks, checks and the library use it. `installVocalSongs()` also runs after an import and at launch when a voice profile exists. Voice songs cannot be deleted from the library.
4. **Saving the range.** `saveVoiceRange(range)` lives in `src/training/voiceProfile.ts` beside `loadVoiceProfile`. It writes the range on profile row 2 and deletes today's voice session when none of its blocks is done or active, so the next visit to Today plans for the new range.
5. **Best results.** A voice run's `score` is `perfects x 100 + goods x 80`, so the song page keeps the best run per level in the order the Coach would rank them.

### Scoring and sound

6. **Attacks.** `VoiceTracker.frame` reports `isAttack` by the same level-jump rule the guitar smoother uses (shared in `voiceEar`), so the Player's count-in check for the speaker's own clicks works on voice runs. A simulation case proves it: guide on, clicks through the phone microphone model, bleed detected.
7. **Own sound through the whole run.** `ownSoundHeard()` looks at every cue, not only the intro cue (for exercises, the first cue and every call). While a voice run has the guide on, a `devicechange` event (headphones unplugged) marks the run partial: practice, not a result.
8. **Guide state.** The guide switch follows `settings.voiceHeadphones` for voice charts in every place the guitar Player follows `echoCancellation`, including after the guide track arrives late and after the microphone is toggled. The "speaker mode" action is not offered on voice charts.
9. **Detector range.** The Player sets the detector on every start (55 to 1500 Hz for guitar charts, the voice range for voice charts) and a voice Player sets it back when it unmounts.
10. **Timing.** `timingMedianMs` is reported as measured. Voice pass criteria are `{ minAccuracy: 0.8, maxMedianMs: 10000, maxStdevMs: 10000 }`, so timing never fails a voice check. Round cards, check results and reports show no timing line for voice.
11. **Sound sync.** The voice set-up's phone step runs the existing sound-sync measurement when the device has none yet, worded for a singer ("Let the phone listen to its own clicks, or clap along"). It can be skipped; checks never wait for it.

### Coach

12. **Steps the range cannot hold.** `maxStepFor(skill, range)` gives the highest step that fits (slides to the octave need 12 semitones, a sixth 9, an octave leap 12). The Coach passes `maxSteps: Record<skillId, number>` to the planner; a block stores `params.maxStep`; the rating target of a run is `params.maxStep ?? steps.length - 1`. A singer with a small range can therefore finish every skill on the highest step their voice can hold.
13. **Day factor for step skills.** After a rough warm-up, pending step blocks start one step easier. The warm-up pool and `excludeCategories` apply everywhere a warm-up skill is picked. "Not the same drill twice" compares skill ids.
14. **Checks.** `checkpointTasks` takes the instrument's options: tempo never under `SkillDef.minTempo`, step skills at their fixed tempo and current step, at most `maxBars` bars, wording from the options ("Sing …"). `/test/checkpoint?instrument=voice` is the only voice check; a placement or monthly check with voice active goes back to Today.
15. **Advice.** `recommendations()` takes the instrument's pass criteria, song speeds and tempo floor. For voice: no calibration card, no slower-song card, no tempo card under the floor, and for step skills a step card or nothing.
16. **Song blocks.** `pickSongBlock` takes the speed list and the wording from the options; every voice song block has speed 1 on every day, including a first day and a comeback day. Voice song blocks carry no bar loop. A song summary may carry `levelDurations`, and the number of passes is fitted to the level about to be sung (echo levels last about twice as long). When a key is lowered the song item's low streak is cleared, so key and level never drop on the same day.
17. **After the course.** Songs marked "after the course" have `lessonLevel` 10.
18. **Skipping the course.** A singer who has sung before, or who leaves the course, starts with "Match a note" at the unlock rating on step 1, so the tier 1 skills are open on day one.
19. **Tired.** "My voice is tired" uses the existing skip for each remaining block and sets `tiredOn`. Streak, finish time and the check counter follow the rules they already follow for skipped blocks.
20. **Copy.** Block titles, pace lines, result lines, milestone text and check errors have voice wording (no "play", no bpm for step skills, no "guitar"). The banned-word tests cover them.

### Screens

21. **Not set up yet.** With voice active and no finished voice set-up, every shell page and `/range` sends the learner to `/start?instrument=voice`.
22. **Set-up order.** Welcome, time, phone (headphones, microphone check, sound sync), range, song, finish. The goal songs are the three course songs that fit every range.
23. **One line at a time.** The song page offers "Practise one line": `arrange(song, { shift, level, onlyLine })` builds that line alone with its starting note (and its call on echo levels). Such a run is practice and is not saved as a song result.
24. **Import and reset warnings.** The confirmation text is chosen from the file's version and contents: a guitar backup replaces guitar only, a backup holding both replaces both, and each of the three resets says what it removes.
25. **Early browser proof.** A hidden page `/voice-check`, present only while `voiceEnabled()`, runs one generated voice exercise in the real Player. The first browser check sings it in tune, flat and not at all, as soon as the Player and the generators exist.

### Further device checks

16. Wired headphones pulled out in the middle of a run with the guide on: the run must end as practice.
17. Update to this version while a second tab or the installed copy still has the app open.
18. Phone volume at zero: no starting note can be heard, and the app cannot know.
19. iOS microphone modes (Voice Isolation, Wide Spectrum) during a sung run.

## 13. Decisions taken while building

These settle questions the packages raised. They win over the sections above.

1. **One held note.** Twenty-six of the fifty-one notes of the Jingle Bells chorus are the same note, so "one hummed note scores under half" cannot hold for every song. The rule is: one held pitch through a whole song is never a clean round (Coach accuracy under 0.75 on every song and level) and stays under 0.5 on every song except Jingle Bells.
2. **Lines are placed by beats.** A line starts at the sum of the beats before it (lines of 7, 9, 15 and 17 beats exist). On echo levels the answer starts a whole number of bars after its call.
3. **Intro.** When the intro bar cannot hold a one-beat starting note and a silent beat before the pickup (When the Saints), the arrangement has two intro bars.
4. **Breaths.** A line that already ends with a written rest of 0.4 s or more keeps its last note whole.
5. **Carried syllables.** A `''` syllable is a scored note of its own that carries the syllable before it, and is drawn as a continuation.
6. **Songs held back.** `needs` on a song holds it back from the Coach's own picks only. The library lists every song that fits the range.
7. **Which side a row is on.** Skill states go by `instrumentOfSkillId`, lessons by `instrumentOfLessonId`, everything else by its stamp; a session without a stamp goes by its block ids. `restartCourse(ids)` clears the course the ids belong to. `initialiseCourse(ids, now)` ends the course on the profile row the ids belong to.
8. **Saving a range.** `saveVoiceRange` moves an easy note that falls outside the range onto its nearest edge, refuses a span under 7 semitones, and keeps today's plan when something was sung in it or the day was ended with "My voice is tired".
9. **Not set up.** The "not set up yet" test reads fields of the singing profile (`experience`, `placementDoneAt`), never whether row 2 exists.
10. **Sources.** No score library could be reached from the build machine. Every melody was written from memory by one engineer, derived again from memory by a second before reading the first, and compared with the guitar bundle where the tune is shared.
11. **Pitch standard.** Singing is always judged against A = 440 Hz, because the starting note, the guide voice and the recorded guitar are at 440. The guitar's "Reference pitch" setting does not apply to sung charts.
12. **Before the tune.** The bars before the tune are not strummed: the guide track there is the click and the starting note alone, and the chords come in on the first bar line of the tune. A strum over the starting note hid it from the own-sound check in low keys.
13. **What was measured differently from sections 3, 4 and 9.** The level gate is twice the room level, not three times. Credit from outside a note's span is capped for early and late together. A frame more than about 60 cents from the frame before is not listened to (it keeps the click's kick drum from reading as a voice). Vibrato credit counts only when the note's median is inside the band. A note begun on the pitch of the note before is lateness, not a slide. Strummed chords alone score 0 to 2 notes in 30, not none, and more in low keys; that can only happen with the guide on, where the run is not counted. A singer 150 ms late on 4.4 notes a second is counted and not clean. One held pitch that wobbles 80 cents can reach 0.62 on Mary Had a Little Lamb at the widest band, all goods: counted, never clean.
14. **Lowest and highest.** The app can only recognise its own starting note from MIDI 35 up. A stored range never goes below MIDI 36 or above 86, whichever way it was entered.
