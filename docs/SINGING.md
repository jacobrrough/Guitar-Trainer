# Singing

One app, two instruments. This document describes the singing side as it is built: what is stored, how singing is scored, how songs and exercises are placed in a singer's own range, how the Coach treats voice skills, the course, the screens, the proof, and what the owner has to check on a real phone.

Where it stands: the singing side is in the build and out of sight. `VOICE_RELEASED` in `src/app/features.ts` is `false`, and a device sees it only with the preview key (`localStorage['gt.voice'] = '1'`). What is proven: the scoring, the exercises, the songs and the lesson rounds in simulation with a computed singer (section 9 says which part of each a plain test run sings); the stores, the planner and the Coach by unit tests; one exercise in a browser. Of the other screens the rules and the words are unit-tested where they are plain functions, and no browser check in the repository walks through them. No part of it has been sung by a person or run on a phone; section 11 lists what that leaves open, and section 12 the limits that are known.

## 1. Decisions in one page

| Question | Decision | Reason |
|---|---|---|
| How does a screen know it is voice? | The chart says so: `chart.voice` is set. The shared Player builds the voice tracker and the pitch lanes from it. | Every wrapper of the Player (Today blocks, lessons, checks, songs) works without a new prop and cannot forget one. |
| Schema | Dexie version 5 changes only `sessions` to `'++id, date, &[instrument+date]'` and stamps old sessions `'guitar'`. | Smallest change that gives one plan per day per instrument; primary keys cannot be changed in place. |
| Other tables | Namespaced ids, a second profile row (id 2), an optional `instrument` field read as guitar when missing. | No rewrite of any other row; song rows with audio bytes are never touched. |
| Scoring rule | Share of each note sung inside a band, octave folded, per-note windows, credit from outside a note's own time capped. | Verdicts are immediate and a flat singer cannot be credited through the neighbouring notes. |
| Widest band | 80 cents; then 65, 50, 35. | At 100 one held pitch satisfies two notes a whole tone apart. |
| Pitch standard | Singing is always judged against A = 440 Hz (`VOICE.a4`). The guitar's "Reference pitch" setting does not apply to anything sung. | The starting note, the guide voice and the recorded guitar chords are at 440 and the chords cannot be moved. With the setting at 432 a singer exactly on the app's notes read 31 cents flat. |
| The app's own sound | While scoring on a speaker only the click and the app's cues play, and the tracker gives no credit while a cue sounds. The sung melody and the chords are on the guide track only. | A guide voice alone scores every note (measured), so it may only play into headphones. |
| Skills where slower is not easier | A ladder of steps at a fixed tempo, with the unchanged rating rule on the step number. | Longer notes are harder and more tiring, so the Coach must never slow them down. |
| Song audio | Nothing stored. Charts are moved to the range and rendered when opened. | No storage growth and nothing to render again when the range changes. |
| Song levels | Six: echo each line, echo two lines, whole tune, in tune, hold the long notes, performance. Speed is always 1. | Help is withdrawn and strictness rises; slowing a song makes phrases outlast the breath. |
| Untimed "find the note" | An unscored tool (a lesson step and the "My voice" page), not a second scored path. | One scored path keeps the Coach simple. |
| A range to sing in | A singer always has one: the stored range, else the starting range of a lower voice, for exercises and songs alike. | A lesson's round and its song are never an octave apart. |
| Release | Everything behind `voiceEnabled()`. | The build can ship at any moment without showing half a voice side. |

## 2. Instruments and stored data

### Types

`src/training/instruments.ts` decides which side a stored thing belongs to (the id type is `InstrumentId` because `Instrument` already means guitar, bass or ukulele in `src/music/tunings.ts`; it is declared in `src/training/types.ts` and re-exported):

```ts
export type InstrumentId = 'guitar' | 'voice'
export const instrumentOf = (row: { instrument?: InstrumentId }): InstrumentId => row.instrument ?? 'guitar'
export const profileIdFor = (i: InstrumentId): 1 | 2 => (i === 'voice' ? 2 : 1)
export const instrumentOfSkillId = (id: string): InstrumentId => (id.startsWith('voice.') ? 'voice' : 'guitar')
export const instrumentOfLessonId = (id: string): InstrumentId => (/^v\d\d-/.test(id) ? 'voice' : 'guitar')
export const instrumentOfBlockId = (id: string): InstrumentId => (id.startsWith('voice-') ? 'voice' : 'guitar')
export function skillsFor(i: InstrumentId): SkillDef[]       // SKILLS | VOICE_SKILLS
export function skillById(id: string): SkillDef | undefined   // both lists
export function courseFor(i: InstrumentId): Lesson[]          // COURSE | VOICE_COURSE
export function activeInstrument(s: Pick<AppSettings, 'instrument'>): InstrumentId  // 'guitar' unless voiceEnabled() and s.instrument === 'voice'
```

`SKILLS`, `SKILLS_BY_ID`, `COURSE` and `BUILT_IN_SONGS` keep meaning guitar. Tests pin them, the guitar simulation plays them with a recorded guitar, and `migrate.ts` only knows guitar ids, so voice states are never touched by guitar tempo corrections. Two traps are written into the code: `instrumentOfBlockId` is only for the blocks of a stored plan (a lesson drill is recorded through a stand-in block `lesson-${skillId}`, whose run is stamped by its skill instead), and an unknown skill id throws wherever something is built or rated from it (there is no fallback to the first guitar skill).

Additions to `src/training/types.ts`, all optional so stored guitar rows stay valid:

```ts
SkillCategory += 'pitch' | 'range' | 'breath'
interface SkillStep { label: string; params: Record<string, unknown>; bonus: number; span?: number }
SkillDef += { minTempo?: number; steps?: SkillStep[] }
SkillState += { step?: number }
AttemptResult += { voice?: { medianCents: number | null; topMissed: number } }
Profile: id: 1 | 2; instrument?: InstrumentId; voice?: VoiceProfile
interface VoiceRange { low: number; high: number; easy: number; measuredLow?: number; measuredHigh?: number;
  source: 'measured' | 'default' | 'manual'; at: number }            // MIDI numbers; low and high are both inclusive
interface VoiceProfile { range?: VoiceRange; keyNudge?: Record<string, number>; tiredOn?: string }
SongItemState += { instrument?: InstrumentId; keyLoweredAt?: number }
instrument?: InstrumentId also on SessionRecord, Attempt, TestRecord, Milestone
```

`src/db/db.ts`: `SongRecord.instrument?: InstrumentId`. `src/chart/types.ts`: `ChartNote.lyric?: string` and `Chart.voice?: VoiceChart` (section 5). `src/lessons/types.ts`: `Lesson.tool?: 'tuner' | 'range' | 'match'` and the seven voice illustration ids.

`src/app/settings.ts`: `instrument: InstrumentId` (default `'guitar'`, a per-device view choice) and `voiceHeadphones: boolean` (default `false`). The range lives on the voice profile because backups carry the profiles and no settings.

`src/app/features.ts`: `voiceEnabled()` is true when `VOICE_RELEASED` is, or when `localStorage['gt.voice'] === '1'`. The storage is read inside a try, so a browser without storage has no preview.

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

Only the sessions line differs from version 4. The plain `date` index stays because `coach.ts` orders sessions by date and `e2e/student.mjs` reads them by date. This is the first `.upgrade()` in the repository. `src/db/db.migration.test.ts` runs the upgrade in Node with fake-indexeddb, from versions 4, 2 and 1, and opens the updated database with the schema of the older code. It has not been run in Safari. If Safari ever needs another shape, that is a version 6, never a redefinition of version 5.

### Sessions and their stamp

A row without the stamp sits outside the compound index, so a second plan for the same day could be saved beside it. The store therefore works like this (`src/training/store.ts`):

- `saveSession(record)` always stamps. The instrument is the record's own, else what the ids of its blocks say, else guitar; a record stamped for one instrument that holds the other's blocks throws. The stamp is written onto the record it was given (as Dexie writes a new id onto it); a frozen record is stored as a stamped copy.
- `peekSession(date, instrument = 'guitar')` reads `where('[instrument+date]')` and, when that finds nothing, searches the day by its plain date for rows without a stamp that are on this side (by their block ids), oldest first. Such rows can exist because a copy of the app still running the older code can open the same database. Nothing is deleted and nothing throws.
- `getSession` is `peekSession` plus stamping what it found. If the stamp cannot be written the row is returned as stored.
- `completeBlock` and `skipBlock` stamp an unstamped row too, and store it unstamped when the stamp for its day is already held by another row: the block the learner just finished matters more than the stamp.

### Scoping, table by table

| Table | Guitar | Voice | Read |
|---|---|---|---|
| profile | row 1 | row 2. `loadProfile('voice')` creates it when missing, so "the row exists" never means "set up" | `loadProfile(i)`, `peekProfile(i)` (read-only), `useProfile(i)`, `markSessionDay(date, i)` |
| sessions | stamped `'guitar'` | stamped `'voice'`, block ids `voice-${date}-${i}-${kind}` | `getSession(date, i)`, `peekSession`, `useTodaySession(date, i)`; the Coach's `planning` map is keyed `${i}:${date}` |
| skillStates | guitar ids | ids `voice.*` | `loadLearnerModel(i)` keeps states by `instrumentOfSkillId`, so a guitar state with a retired id is still a guitar state |
| lessons | `l01-…` | `v01-…` to `v10-…` | `courseProgress(ids?)`; `restartCourse(ids)` deletes every row of the course the ids belong to and writes fresh ones; `initialiseCourse(ids, now, profileId)` defaults to the profile row the ids belong to |
| songs | no field | `instrument: 'voice'`, `builtinId: 'sing-…'`, no audio | `useSongs(i)`, `listSongs(i)`, `songSummaries(i)` |
| songItems | key `${songId}:${level}` | same, stamped from the first run | by the stamp, in `loadLearnerModel` |
| attempts, tests | no field | stamped | `recentAttempts({ instrument })`, `listTests(limit, i)` leave the other side out before the limit |
| milestones | keys as stored | stamped; streak and test keys prefixed `voice:` (`voice:streak:7`) | `listMilestones(limit, i)`, `milestonesSince(ts, i)`; the "seen" mark is `gt.milestonesSeenAt.voice` |

Every new parameter defaults to `'guitar'`. One exception is deliberate: `recentAttempts` with a `skillId` or a `songId` and no instrument applies no side filter, because a skill and a song belong to one side already. `recentFocusSkillIds` and `recentRecapSkillIds` in `coach.ts` count sessions of one instrument only. The hooks in `useTraining.ts` call the read-only `peek…` functions, because a live query must never write.

### Backup, restore, reset

Export is version 2: the version 1 object (with `profile` = row 1) plus `profiles: Profile[]`. Import accepts 1 and 2.

- A version 1 file is a guitar backup. In one transaction it deletes guitar rows only and leaves every voice row. Only the guitar rows of the file are taken: an older copy of the app on a device that already sings writes version 1 with singing rows in it. Because attempts, sessions, tests and milestones share `++id` tables with voice rows, the ids in the file are dropped, the database gives new ones, and each imported `Attempt.sessionId` (also the copies inside stored checks) is rewritten to the new id of its session. A song item or milestone of the file whose key is held by a singing row here is left out.
- A version 2 file replaces both sides. A version 2 file without a singing profile therefore clears singing on the device.
- Every imported session goes in stamped. If a backup holds two unstamped plans for one instrument and day, the older gets the stamp and the other goes back unstamped, or that device's own backup could not be restored.
- `resetTrainingData(instrument?)` deletes one side by the same predicates, or everything.

The Settings page asks before an import in words chosen from the file and the device (`importWarning`, `pickBackup` in `src/features/settings`): a guitar backup replaces guitar only, a backup holding both replaces both, and a backup without singing on a device that sings says the singing progress and easy notes here will be gone. With the singing side on, the page offers three resets (guitar, singing, both) and each says what it removes; with it off, the one reset and its words are as before. After an import of either kind the songs to sing are written when the singing side is on and the singer on the device is set up (`restoreBackup` in `dataSection.ts`). Known limit, unchanged: backups hold no songs. Vocal rows are tiny and are written again on demand.

### Switch and routes

A two-segment control "Guitar | Singing" (`instrument-switch`, `instrument-guitar`, `instrument-voice`, `aria-pressed`) is drawn by `AppLayout` only when `voiceEnabled()`: above the page on `/`, `/songs`, `/progress` and `/lessons` on a phone, under the brand on a wide screen. It only calls `updateSettings({ instrument })`; nothing stored moves. The phone bar keeps six places; with singing showing, "My voice" (`/range`) stands where the guitar has its tuner.

List pages read `activeInstrument(settings)`. Entity pages take the instrument from the entity: lesson id, block id prefix, song record. Routes added in `src/main.tsx`: `range` in the shell, `/sing/:songId` full screen, `/start?instrument=voice` (the same `StartHere` component), and `/voice-check`, which is registered only while `voiceEnabled()`. `/play/:id` of a voice record goes to `/sing/:id`, and `/sing/:id` of a guitar record to `/play/:id`. `BUSY_ROUTES` in `appUpdate.ts` holds `/sing/`, `/range` and `/voice-check`, so an update never reloads them.

Not set up yet: with singing showing and no finished set-up, every page of the shell and `/range` sends the learner to `/start?instrument=voice` (`setUpDoor` in `wizardState.ts`); the lesson pages, the song page, the singer's library and a sung check do the same. "Set up" is read from the singing profile's `experience` and `placementDoneAt` (`voiceIsSetUp` in `voicePlan.ts`), never from whether row 2 exists. With the voice side off, a typed address of a voice lesson shows "We could not find that lesson", as an unknown id does, and `/sing/:id` and `/range` go home.

Manifest id, scope, database name and storage keys do not change.

## 3. Scoring singing

Files: `src/features/play/runTracker.ts` (seam), `src/features/play/voice/judge.ts` (constants), `voiceEar.ts` (frame rules, shared with the range finder), `voiceTracker.ts`, `simulateVoice.ts`. `scoring.ts` and `scoreFrame.ts` are untouched.

### Seam

```ts
export type NoteState = Pick<GroupState, 'group' | 'status' | 'judgement' | 'hitAt'>
export interface RunTracker {
  readonly needsSpectrum: boolean
  setSpeed(s: number): void; reset(): void; seek(t: number): void; setRange(from: number, to: number): void
  nextPass(): void; markUnscored(): void; advance(t: number): NoteState[]; onPlaybackStart(): void
  frame(frame: PitchFrame, songTime: number | null, settings: FrameSettings): FrameOutcome
  stateOfNote(noteId: number): NoteState | undefined
  progressOf?(noteId: number): NoteProgress | undefined
  ownSoundHeard?(): boolean
  summary(): ScoreSummary
  toAttemptResult(o: { playedTempo: number; targetTempo: number; speed: number; durationSec: number }): AttemptResult
}
export function createRunTracker(chart: Chart, notes: ChartNote[], o: RunTrackerOptions): RunTracker
```

`createRunTracker` returns a `VoiceTracker` when `chart.voice` is set, otherwise `guitarRunTracker`, a wrapper around `ScoreTracker` plus `PitchSmoother` whose `frame()` is the `scoreFrame` call the Player always made. `RunTrackerOptions.sampleRate` may be a function; it is called only for a sung chart, when the first frame arrives, so the Player needs no audio context to build its tracker. A sung note is handed out as a group of one, so the highway's own `statusOf` takes either tracker. `laneRenderer.ts` chooses the renderer the same way (`createLaneRenderer(chart, canvas)`), and `playerLabels.ts` the words and the few rules that differ.

`simulate.ts`: the scoring loop is `runHeard(tracker, heard, durationSec, options)`; `scoreHeard` keeps its signature and its numbers, and the guitar simulations hold it to that.

Detector for a voice run (`voiceDetector` in `judge.ts`, set by the Player at every start through `detectorFor(chart)`): `minFreq = max(60, hz(low - 14))`, `maxFreq = min(1200, hz(high + 14))`, threshold 0.9, spectrum off. `low` and `high` are the chart's. A guitar chart gets `PLAYER_DETECTOR` (55 to 1500 Hz, threshold 0.9) at every start, and a Player that set the voice range sets `PLAYER_DETECTOR` back when it unmounts. `settings.clarityThreshold`, `octaveTolerance` and `a4` are not read for a sung chart.

### Constants (`VOICE` in judge.ts; seconds of real time and cents, never frames)

A frame is 512 samples of whatever rate the microphone runs at: 11 or 12 ms on a phone's own microphone, 21 or 32 ms through a wireless headset that puts the audio context at 24 or 16 kHz. The tracker scales the seconds by the playback speed.

| Name | Value | Why |
|---|---|---|
| a4 | 440 | see section 1 |
| clarity | 0.6 | room noise alone read at most 0.59; a quiet, breathy voice through the phone model 0.68 to 0.87. The click's kick drum (0.65 to 0.78) and a strummed chord (up to 0.89) read there too, so clarity cannot tell those from a soft voice |
| minRms, floorFactor, gateCap | 0.004; 2 x the quiet fifth of the levels heard in the count-in (needs 0.25 s of it); never over 0.02 | room floor. A factor of 3 shut quiet singing out (a singer at level 0.02 came to 0.56 to 0.68); at 2 every note is perfect down to level 0.015, and a voice at 1.6 times the room is still not heard |
| windowCentre | 1024 / sampleRate | the detector reports the pitch of the middle of its 2048-sample window |
| early | 0.10 s | a note begun a little early |
| late, outsideShare | 0.25 s and 0.35: a note's late window is min(0.25 s, 0.35 x judged length) after its end, and the same amount is the most that frames outside the note's own span, early and late together, can add | lateness is not wrong pitch. The cap is under every share that makes a hit, so nobody is credited through the neighbouring notes |
| onsetSkip | min(0.12 s, 0.3 x note) | scoops and consonants |
| release | min(0.06 s, 0.15 x note) | the end of a note is never required |
| minJudged | 0.08 s | the judged part is never shorter |
| vibratoMean | 0.17 s, at least 0.09 s voiced, every frame within 150 cents | a swing averages out, a steady offset does not. Measured clean for swings of 50 to 100 cents at 4.5 to 7 a second; 0.12 s was too short for a slow wide swing |
| slip | one frame over 900 cents from both neighbours is dropped | the detector locking on to a harmonic for one frame |
| steadyRate | 5168 cents a second (60 cents in the 11.6 ms of a frame at 44.1 kHz) | the click's kick drum falls 46 to 276 cents a frame and read as a voice; a singer moves at most 12, with an 80-cent vibrato at 7 a second 42 |
| shortNote | under 0.25 s: a hit needs 0.08 s in tune | quick notes |
| perfect | share >= 0.8 and median error within `max(25, 0.6 x band)` cents: 48, 39, 30, 25 for the four bands | the Coach counts a good as 0.8, so a singer comfortably inside the band must be able to earn a clean round (0.85) |
| silentShare | 0.25 | voiced for less of its judged length, a note was not heard |
| cueBefore, cueAfter | 0.05 s before, 0.30 s after | the app's own cue and its tail |
| ownSound | 0.15 s within 60 folded cents of a cue, the first no later than 0.15 s after the cue began, with nothing on that pitch in the 0.25 s before it; a cue shorter than 0.25 s needs 0.6 of its length | a speaker is on time; a person humming along starts later, and one who was already singing did not start with the cue |
| sustainGap | 0.25 s | with sustain on, a long note let go earlier is good at most |
| settle | `settleWait(rate) = max(0.1, windowCentre + one frame + 0.065)`: 0.1 s at 44.1 and 48 kHz, 0.16 s at 16 kHz | the frames of the last moment that can count are still on their way |
| slide | 0.06 s within the first 0.2 s more than 100 cents under | "you slid up to the notes" |
| topSemitones | 3 | "the key sits too high" looks at the top of the piece |
| points | perfect 100, good 80 | the best run on the song page is the one the Coach ranks first |

### Rule

1. A frame is voiced when `freq > 0`, `clarity >= 0.6` and `rms >= gate`. The gate is measured only from frames before the song begins (`RoomFloor`). The frame's time is the Player's latency-compensated song time minus `windowCentre`.
2. `VoiceEar` gives every frame the real time it stands for, from the time stamps, so nothing downstream counts frames. A single frame more than 900 cents from both neighbours is held back until the next frame shows whether it was a leap (both pass) or a slip (it is gone).
3. A frame is listened to only when the heard frame before it is no more than two and a half frames back and no further away than `steadyRate` allows for the time between them, octaves folded. This is what keeps the kick drum out.
4. Octave: `cents = 1200 * log2(freq / target)`, `folded = cents - 1200 * round(cents / 1200)`. Any octave counts. The octave it was sung in is kept for the line "You sang it an octave lower. That counts."
5. A frame inside `[cue.time - 0.05, cue.end + 0.30]` of any entry of `chart.voice.cues` is dropped: no credit, no coverage.
6. Each frame is credited to at most one note. First the note whose written span holds it: when `|folded| <= band`, or when the mean of that note's own frames over `vibratoMean` is inside the band. What only the mean lets through is kept apart and counts only if the note's median ends up inside the band (without this, 60 cents flat at a band of 50 scored 2 notes in 30 on falling semitones). Otherwise the note before, if the frame is inside that note's late window and inside its band; otherwise the note after, if inside its early window and its band. Credit from outside is capped per note as the table says.
7. Per note: `judged = max(0.08, duration - onsetSkip - release)`, share = min(1, seconds in tune / judged). A hit needs `minShare x judged` in tune (`judge.minShare` is 0.5 or 0.6, never lower), and a quick note at least 0.08 s. Perfect as in the table, else good. With `judge.sustain`, a note of one beat or more whose last counted frame is more than 0.25 s before its written end is at most good. A note is settled at its end plus its late window plus `settleWait`. Frames settle notes as well as the clock, and `advance` returns every miss since the last call.
8. Reasons are kept per note for feedback, not for the score: `silent`, `low` or `high` (median outside the band), `unsteady` (median inside, too little of the note in tune), and on a note that counted `slid`. A note begun on the pitch of the note before, within the time lateness is allowed, is lateness and not a slide.
9. Attacks: `frame()` reports `isAttack` by the level-jump rule the guitar smoother uses (`LevelJump` in `voiceEar.ts`; a test holds the two together), so the Player's count-in check for the speaker's own clicks works on voice runs.

### Results

`summary()` is the existing `ScoreSummary` (score `perfects x 100 + goods x 80`, multiplier always 1) with one extra field, `voice: VoiceFeedback` (`notes`, `hits`, `reasons`, `octave`, `medianCents`), read with `voiceFeedbackOf(summary)`.

`toAttemptResult()`: perfects, goods, misses and total per note; `coverage` = share of settled notes that were heard (voiced for at least a quarter of their judged length, or hit); `perBar` from note results over every loop pass; `timingMedianMs` = median of (first counted frame minus note start) with 8 or more hits, else null, reported as measured; `timingStdevMs` always null; `voice.medianCents` (the median of the notes' medians); `voice.topMissed` = misses with reason low or silent among the notes in the top three semitones of the piece.

Consequences in shared code:

- `runVerdict` gives `unscored` for a run with no hit and coverage under 0.2 (nobody sang, or the phone was too far away), `bleed` when the app heard its own sound, `partial` when the headphones changed on the way. The words are `NOT_COUNTED_VOICE` in `runVerdict.ts`.
- Voice pass criteria are `VOICE_TEST_PASS = { minAccuracy: 0.8, maxMedianMs: 10000, maxStdevMs: 10000 }`: a singer inside the band on every note, but only just, earns "good" on each and passes; timing never fails a voice check. Round cards, check results and reports show no timing line for voice.
- The pass mark is compared through `reachesMark(accuracy, mark)` (tolerance 1e-9) in `assessment.ts` and on the result card. A run where every note is good is exactly 0.8, but `(0.8 x n) / n` comes out a digit under for some counts of notes (43, 81, 86 and 91 are the ones under 100).
- `attemptPerformance` gets a sound-sync age of 0 for voice (`syncAgeDays` in `coach.ts`): a sung result never waits for the measurement and never counts for less without one.

## 4. The app's own sound

Measured through the real analyser (`voice.sim.test.ts`): a guide voice alone scores every note of the piece; strummed chords alone score 0 to 2 notes in 30 on the recorded guitar, whatever the band, and more in a low key. So:

- **Scored track** (the Player's `audio`): click plus the cues in `chart.voice.cues`. Cues are the starting note before the tune and the guide's turns in echo forms. Builders guarantee at least one beat between the end of a cue and the next scored note (`VoiceBuilder.build` refuses anything else, and the song arranger shortens or delays a call), and rule 5 mutes them.
- **Guide track** (the Player's `guideAudio`): click, cues, the scored notes sung by the guide voice (song levels 0 to 3 and all exercises), and for songs the strummed chords. Used by "Listen first", and while scoring only when the guide is on. The bars before the tune are not strummed: there the guide track is the click and the starting note alone, and the chords come in on the first bar line of the tune. A strum over the starting note hid it from the own-sound check in a low key.
- **Guide on** is for headphones. The switch starts where `guideStartsOn` says: for a sung chart on `settings.voiceHeadphones` and nothing else (asked in set-up, changed in Settings), at mount, when the guide track arrives late and nothing is playing, and when the microphone is switched back on. A track that arrives during a run is applied at the end of it, never under the count-in.
- **Two proofs that the speaker is being heard**, both only asked while the guide is on. The count-in rule: attacks right after the app's own clicks (`detectBleed`). And `ownSoundHeard()`, which looks at every cue, not only the first. When either fires the run is `bleed` and is not saved, `voiceHeadphones` is set back to false, and the guide switch of the mounted Player goes off once the run is over, so "Try again" can count. The notices are `VOICE_LABELS.bleedNotice` ("The microphone is hearing the speaker, so this run will not count. Use headphones, or turn the guide off.") and the softer `ownSoundNotice` ("The microphone seems to be hearing the guide…"): a singer with headphones on who joins in with the guide from its very first moment cannot be told from the speaker, and a test keeps that limit in sight.
- **Headphones pulled out.** While a sung run has the guide on, a `devicechange` event from the count-in to the end marks the run partial: practice, not a result. An event within 3 s of this Player opening the microphone is ignored (`DEVICE_SETTLE_SEC`), because granting the permission and a wireless headset changing to its call mode raise the same event. Not verified on a device.
- **Speaker mode** (echo cancellation) is not offered on a sung chart (`bleedAction: null`): it would take the voice out with the guide.
- For a sung chart the count-in rule asks only whether the guide is on (`ownSoundCounts`); `backingIsClick` is not read, so a screen that forgot the prop cannot turn every bare-phone run into bleed.

On a bare phone the learner therefore sings to a click and a starting note. That is bare, and it is the only arrangement that cannot score itself.

## 5. Range, key and songs

### Finding the range

`src/features/voice/rangeFinder.ts` (pure: the rules, the step reducer, the words) and `RangeFinder.tsx` with the contract `{ onDone(range), onSkip, autoStart }`. The microphone is held through `VoiceMic` in `PitchLadder.tsx` (`claimMic` / `releaseMic`; the detector is 60 to 1200 Hz while listening and is handed back as 55 to 1500 Hz); frames go through `voiceEar`. Used in the set-up, in lesson 1 and from `/range`. Five steps, under a minute, each skippable, each with "Stop while it is easy. This is not a test of how high you can go."

1. "Hum any note that feels easy" (listened to for 4 s, needs 1.5 s voiced): `easy` = the rounded median pitch; the hum's level is kept. A "hum" whose smallest range would leave MIDI 36 to 86 (an easy note under 39 or over 82) is not a hum: mains hum, a fan and a whistle have a clear pitch too.
2. "Slide down gently, like a sigh, and stop when it starts to croak", twice: `measuredLow` = the lowest note held. `low = measuredLow + 2`.
3. "Slide up quietly, like a small siren", twice: `measuredHigh` = the highest note held. `high = measuredHigh - 3`.
4. When that leaves under 7 semitones, when an edge is outside MIDI 36 to 86, or when no slide was heard: `low = easy - 3`, `high = easy + 4`, source `'default'`, said plainly. One side skipped takes its edge from that small range and the result is still `'measured'`. A span over 14 is cut to 14: six under the easy note and eight over, moved as far as it has to be to stay inside the comfortable notes.

What "held" means: 0.3 s of unbroken voice (holes up to 0.05 s bridged) in which the voice was at or under the note for all but a tenth (at or over, for a top note). On a slide that never stops this reads a little short of the end, never past what was sung. A low stretch counts only at half the hum's level or more (under it, it is a croak), a top stretch only at twice the hum's level or less (over it, it was forced); the limit is asked of the stretch's middle level, not of each frame. The slides are hummed with closed lips like the hum, because they are judged against its level. A slide up that was over twice the hum throughout gets its own line instead of "move closer".

Timings: a step waits 10 s for a voice, a slide is listened to for at most 6 s, a step ends by itself after 1 s of quiet, a voice carried over from the step before is ignored until it has stopped for 0.3 s or moved 2 semitones in the step's direction, and a step starts over when no frame arrives for 0.5 s.

The finder stores the range itself through `saveVoiceRange` the moment the result exists and hands the stored range to `onDone`. Skipping the hum, or everything, leads to two buttons, "Lower voice" (48 to 55, easy 52) and "Higher voice" (60 to 67, easy 64), each playing its note; one of them must be chosen, so the set-up never finishes without a range. The app never infers anything from sex. The result screen "Your easy notes" has "A bit lower" and "A bit higher" (one semitone, source `'manual'`), which stop at MIDI 36 and 86 with a short line, and "Keep the notes I had" when a range was stored before the finder opened. The range is never widened automatically.

### What is stored

`saveVoiceRange(range, now)` in `src/training/voiceProfile.ts` writes the range on profile row 2. It refuses a range that is not whole notes, spans under 7 semitones (`MIN_RANGE_SPAN`: eight notes, a five-note scale with room to spare), or goes below `LOWEST_RANGE_NOTE` 36 or above `HIGHEST_RANGE_NOTE` 86 (below 36 the app cannot recognise its own starting note). An easy note outside the edges is moved onto the nearest edge instead of being refused. Today's singing plan is deleted when nothing in it has been sung, so the next visit to Today plans for the new range; it stays when a block is done or under way, when any round was recorded for it, or when the day was ended with "My voice is tired".

`recordFelt('tight')` (the answer to "How did the slides feel?" after a counted round of slides) lowers `high` by one, never under `low + 7`. "Tight" always wins over the numbers.

### Key

`src/music/keys.ts`:

```ts
chooseKey(span: { low; high; centre }, range: { low; high }, nudge = 0): { shift: number; fits: boolean }
placePattern(offsets: number[], range: { low; high; easy }, seed: number, count?: number): number[]   // home notes for the keys of one round
fittingForm(forms, range)        // the first (widest) form the range can hold
spanOfSteps(steps, home = 60)    // { low, high, centre } of written steps, weighted by beats
```

A song is written in semitones above a home note at MIDI 60 (`WRITTEN_HOME`). `VoiceRange.low` and `high` are both inclusive: every note the app ever asks for satisfies `low <= midi <= high`. The headroom was already taken by the range finder, so nothing is added or subtracted here. Candidates are the shifts that keep the whole tune inside the range. The one whose beat-weighted centre is nearest the middle of the range is taken (a tie goes to the lower), unless it or a neighbour a semitone away has a home note of C, D, E, G or A (open chord shapes, no capo): then the nearest of those. No candidate: `fits` is false, the shift returned is only where the song would sit most evenly, and the song must not be sung. `nudge` is `profile.voice.keyNudge[builtinId]`, -3 to +3 (`setKeyNudge`), and never moves the song out of the range; "Lower" and "Higher" on the song page change it.

`placePattern` puts the pattern's middle on `easy`, moves up a semitone per repetition while the top stays at or under `high`, then comes back; with `count` it is exactly that many keys. `seed` is the day's variation: it moves the first key by 0, +1, -1, +2 or -2 semitones, clamped into the range. A pattern wider than the range has no place and the result is empty; generators ask `fittingForm` first (1-3-5 instead of 1-3-5-8 when the range has no octave).

### A song as data

`src/songs/vocal/`:

```ts
type VocalStep = [semitonesAboveHome: number | null, beats: number, syllable?: string]   // null = rest
type Degree = 'I' | 'IV' | 'V' | 'V7' | 'vi' | 'ii'
interface VocalSong { id: `sing-${string}`; title: string; credit: string; description: string; bpm: number;
  beatsPerBar: 3 | 4; pickupBeats: number; lines: VocalStep[][]; chords: Degree[]; lessonLevel: number; needs?: string[] }
```

Syllables: one per note, a trailing hyphen when the word goes on, `''` for a syllable carried over from the note before (a scored note of its own, drawn as a continuation). The list is `VOCAL_SONGS`, never appended to `BUILT_IN_SONGS`, and every tune, line and note is frozen.

```ts
interface VoiceCue { time: number; duration: number; midi: number; lyric?: string }
interface VoiceJudge { band: 80 | 65 | 50 | 35; minShare: 0.5 | 0.6; sustain?: boolean; perfectCents?: number }
interface VoiceChart { judge: VoiceJudge; cues: VoiceCue[]; low: number; high: number; tonic: number; shift: number;
  lineStarts: number[]; hideAnswers?: boolean; glide?: boolean; onlyLine?: number }
```

`chart.voice.low` and `high` are inclusive bounds that every note and cue lies within; the lanes and the detector are set from them. For a song they are the song's own lowest and highest note in the key (also for one line alone, so the lanes keep their scale); for an exercise they are the singer's range. `lineStarts` is the start time of the first sung note of each line.

### Arranging (`arrange.ts`, `levels.ts`)

`arrange(song, { shift, level, onlyLine? }): Chart` builds notes on `constantBeatGrid`: `midi = 60 + offset + shift`, string 0, fret 0, each note its own `chordId`, `lyric`, standard tuning, capo 0, so guitar-typed code stays valid.

- **Lines are placed by beats**, never by counting bars: four tunes have a line that starts with a pickup of its own (lines of 7, 9, 15 and 17 beats exist).
- **Before the tune**: the first sung note as a cue from beat 0 for `min(2, free beats - 1)` beats, at least one silent beat, then the tune (a pickup sits at the end of those bars). One bar is enough unless the pickup leaves fewer than two beats of it free; then there are two (When the Saints).
- **Breath**: the last note of a line is shortened so that 0.4 s of rest follows (`BREATH_SEC`). A rest written there counts towards it, so a line that already ends in a rest that long keeps its last note whole; so does the last line.
- **Echo levels**: the guide sings a turn (its call, the same notes) and the singer answers a whole number of bars later, so the answer sits in the bar as the call did. Where a call runs right up to the bar line its last note gives up one beat (never more, and it keeps at least one) so the answer can follow at once; otherwise the answer waits a bar. On level 1 the lines are paired in order and an odd last line is a call of its own. Echo levels last about twice the tune; `levelDurations(song)` tells the planner.
- **One line**: `onlyLine` builds that line alone with its starting note (and its call on the echo levels); the chart says so (`voice.onlyLine`) and such a run is practice.
- A level, shift or line index that is out of range or not a number is read as the nearest valid one.

`accompanimentChart(song, shift, level, onlyLine?)` uses the same grid with one strum on beat 1 (and beat 3 in 4/4) from the first bar line of the tune. Chords are named by degree and played with the shapes of five keys and a capo of 0 to 2 (`KEY_FAMILIES`): C=C+0, C#=C+1, D=D+0, D#=D+1, E=E+0, F=E+1, F#=E+2, G=G+0, G#=G+1, A=A+0, A#=A+1, B=A+2. Some of those shapes are barre shapes (F, B, Bm, C#m, F#m). The ten tunes use only I, IV, V and V7.

### Levels (index 0 to 5 = `SongItemState.level`; `VOICE_LEVELS`)

| Index | Name | Form | Shown | Band | Share | Guide track |
|---|---|---|---|---|---|---|
| 0 | Echo each line | the guide sings a line (cue), you answer it over clicks | la | 80 | 0.5 | doubles your line |
| 1 | Echo two lines | the same, two lines at a time | la | 80 | 0.5 | doubles |
| 2 | Whole tune | straight through, starting note only | words | 65 | 0.5 | doubles |
| 3 | In tune | as 2 | words | 50 | 0.5 | doubles |
| 4 | Hold the long notes | as 2, sustain on | words | 50 | 0.6 | chords and starting note only |
| 5 | Performance | as 2, sustain on | words | 35 | 0.6 | chords and starting note only |

Every level scores the same notes with the same lengths, so `levelNoteCounts` has six equal entries. The existing ladder applies with a speed list of `[1]`: up at 0.9, back after two runs under 0.7. `songLevelDifficulty` (30 + 10 x index) is kept.

### Stored and played

`vocalSongRecord(builtinId)` (`install.ts`) returns the stored row and writes it first when it is missing, matching by `builtinId` inside one transaction, so the row id never changes and two callers cannot write two rows. A row is light: `instrument: 'voice'`, `source: 'builtin'`, `builtinId`, `builtinRev = vocalRevision(song)` (its own fingerprint of the tune and of an arrangement version; the guitar's `contentRevision` is not involved), `chart = arrange(song, { shift: 0, level: 2 })`, `audioName: '${id}.voice'`, and no audio. A row made from an older version of a song is brought up to date in place; its id, results and play count stay. `installVocalSongs()` writes every missing row: in the set-up, after an import, and at launch for a device that has a singing profile row while the singing side is on. `hasStaleAudio` and the refresh loop skip voice rows, which would otherwise look stale at every launch. Voice songs cannot be deleted from the library.

`vocalRun(song, { shift, level, onlyLine })` (`render.ts`) makes the arrangement and its two tracks: the scored track at once (click from `renderDrums` plus cues from `renderVoiceNotes`, as a WAV), and the guide as a promise (the scored track, the melody sung on the levels that double it, and the chords from the guitar's own render job `renderChartVoiced`, mixed at half their level and limited). If the chords fail the guide is voice and click alone. The last three runs are kept in memory under `${id}:${rev}:${shift}:${level}:${VOICE_SYNTH_VERSION}`, with `:line${n}` for one line alone.

`useVocalRunState(record, level, { onlyLine }?)` (`useVocalRun.ts`) is what a screen uses. It answers `{ status: 'none' | 'preparing' | 'failed' }` or `{ status: 'ready', run }`, where the run holds `key`, `chart`, `notes`, `audio`, `guide`, `shift` and `fits`. Nothing is rendered inside a React render: the first answer is always `preparing`, the tracks are made after the page has painted (`afterPaint`), and the run is handed out when both tracks exist, so the Player never mounts with half of its sound. The profile is read live, so a new range or key gives a new run. Without a stored range the song is arranged in `DEFAULT_RANGES.lower`. `useVocalRun` is the same, as the run or null.

Stated limit: only the chords are rendered off the main thread. Arranging, click, cues, guide voice and both WAV encodings run on the main thread after the paint.

### The songs

| Song | Span (semitones) | bpm | Opens after lesson | Needs |
|---|---|---|---|---|
| sing-hot-cross-buns | 4 | 72 | 4 | |
| sing-mary-lamb | 7 | 84 | 5 | |
| sing-ode-to-joy, sung with "Joyful, joyful" | 7 | 80 | 6 | |
| sing-aunt-rhody | 7 | 84 | 7 | |
| sing-saints | 7 | 108 | 8 | |
| sing-london-bridge | 9 | 84 | 8 | |
| sing-jingle-bells, the 16-bar chorus | 7 | 88 | 9 | |
| sing-twinkle | 9 | 80 | 9 | |
| sing-amazing-grace | 12 | 84 | the course (`lessonLevel` 10) | voice.interval.triad |
| sing-happy-birthday | 12 | 80 | the course (`lessonLevel` 10) | voice.interval.leaps |

The four songs the course sings (Hot Cross Buns, Mary, Ode to Joy, Saints) span 7 or less, so they fit every range the app stores. `needs` holds a song back from the Coach's own picks only (`coachOffersSong`: it fits the range and each needed skill is rated 50 or more); the library lists every song that fits the range.

Sources: no score library could be reached while the tunes were written. Every melody, rhythm and syllable split was written from memory by one engineer and derived again from memory by a second before reading the first, and compared with the guitar bundle where the tune is shared (`tunes.test.ts` pins every tune note for note). That is agreeing memories, not a score. Rhythms are simplified in two places where many prints dot the first note: even quarters in Mary Had a Little Lamb, even half beats on "Hap-py".

### The key the Coach lowers

Two counted song runs in a row with `voice.topMissed >= 2` (`satHigh`), both sung since the Coach last lowered the song, lower its key by one semitone (`lowerKeyIfTooHigh` in `coach.ts`, `lowerKeyNudge` in `voicePlan.ts`). It needs a stored range. The song item gets `keyLoweredAt` and its low streak is cleared, so key and level never drop on the same day. `recordSongPlay` returns `keyLowered: true`, the result screen says "That one sat high for you, so we moved the song down a little.", and the next plan gives that sentence as the song's reason until the song has been sung again.

## 6. Skills, exercises and the Coach

### Skills (`src/training/voiceSkills.ts`)

T = tempo skill (ref / start / target / floor in bpm). S = step skill at one fixed tempo (ref = start = target = floor).

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

Step ladders (label; band; bonus; semitones of range needed, where a step needs more than the smallest range):

- match: close notes (four within 2 semitones of the easy note, held 3 beats); 80; 0 | wider notes (within 4); 65; 12 | all your easy notes (a pool of six across the range); 50; 20 | after a short note (the same, the app's note only one beat long); 35; 28.
- hold (sustain on, share 0.6): 4 beats; 65; 0 | 6 beats; 50; 8 | 8 beats; 50; 16 | 8 beats, right on the note; 35; 24.
- slides (home, top, home; the glide between is drawn, not scored; a crack is information): up to note 3; 80; 0 | up to note 5; 80; 8; needs 7 | up to note 8; 65; 16; needs 12.
- echo (answers hidden until judged): tunes of 3 notes; 80; 0 | tunes of 4 notes; 65; 8 | tunes of 5 notes; 50; 16.
- phrases: up and back once; 65; 0 | up and back twice; 50; 8 | twice, with a long last note (4 beats); 50; 16.
- leaps: up to note 4; 65; 0; needs 5 | up to note 5; 50; 6; needs 7 | up to note 6; 50; 12; needs 9 | up to note 8; 50; 18; needs 12.
- alone (one starting note, then clicks only): five notes up and back; 50; 0 | five notes, then note 1 again (after the rest of the bar and two silent bars); 50; 10 | note 1 again, right on the note (the same, judged closer); 35; 20.

The tempo skills are judged at band 80 (steps) and 65 (the other four), share 0.5.

Left out on purpose: a rhythm skill (the tracker reports no onset spread), a scored hum and a breath-flow skill (no pitch; level is weak evidence), finding the note from chords (no chords under exercises), louder and softer, and a wider-range skill.

### Generators (`src/training/exercises/voice/`, registered in `GENERATORS`)

`voiceEcho`, `voiceHold`, `voicePattern`, `voiceSlide`, built with `VoiceBuilder` (`note(beat, beats, midi, lyric)`, `cue(beat, beats, midi, lyric)`, `build(judge, range, { tonic, hideAnswers, glide })`). `build` throws when a note or cue lies outside the range, when a cue ends less than a beat before a scored note or sounds during one, or when the round needs more than 8 bars, so no generator can hand out such a chart.

- All exercises are call and answer: the app sings (cues), then the learner answers over clicks from the first beat of the next bar. In tiers 0 and 1 the call is the whole pattern; from tier 2 on it is the first note only.
- A turn takes 2, 4 or 7 bars (a turn that comes to three gets a fourth as rest). The number of notes in a round follows the bars: "Match a note" sings 4 of its notes in 8 bars. One whole turn is always built, also where it is longer than what was asked.
- On a ladder the content is the step's own params and nothing else. The step built is the one asked, as far as the ladder goes, as far as the plan allows (`params.maxStep`) and as far as the range has room (`maxStepFor`); when those disagree (the range was made smaller mid-day) the exercise is the highest step that fits and its returned params say so, because the rating reads the step from the run.
- Generator defaults carry no range. Without `low` and `high` the exercise is built in `DEFAULT_RANGES.lower` and says so in its params; a range under 7 semitones throws.
- "Match a note" does not move from key to key: steps 0 and 1 stay around the easy note every day, steps 2 and 3 take their notes from six places across the range, and the day changes only which notes come and in what order. Every other exercise moves key by day through `placePattern`.
- The exercise id is `${generatorId}:${hash of the params and the skill id}`: two skills that share a generator and a tempo would otherwise share an id. `interaction` is `'highway'`, `backing` is null until rendered.
- A generator id that starts with `voice` and is not registered throws; it never falls back to the guitar `melody`.

Sound (`backing.ts`): `renderExerciseBacking` and `renderExerciseGuide` branch on `chart.voice`. Scored track = click + cues; guide = the same plus the answers sung. No chords under exercises.

The range reaches a generator at build time, never from the stored block: `exerciseForBlock(block, tuning, range?)`, `exerciseForTask(task, tuning, range?)` and `lessonDrillExercise(lesson, tuning, range?)` put `low`, `high`, `easy` last into the params, so a range made smaller mid-day is honoured by the very next exercise, and the values are in the `Attempt.params` of block and lesson rounds.

### How each Coach rule applies

Planner options for voice. All are optional `PlannerInput` fields with the guitar's values as defaults; `voicePlanOptions(range, gentle)` in `voicePlan.ts` puts them together.

| Option | Guitar default | Voice |
|---|---|---|
| `idPrefix` | `''` | `'voice-'` |
| `warmupCategories` | picking, fretting, timing | pitch, range |
| `maxBars` (in `fitRounds`) | 32 | 8 |
| `templates` (warm-up, main, second, song, recap) | `SESSION_TEMPLATES` | 10: 2/4/0/4/0; 20: 3/6/0/7/4; 30 and 45: 3/7/5/10/5 |
| `songSpeeds` | 0.75, 0.85, 1 | 1 |
| `excludeCategories` | none | range, on a gentle day |
| `sameDrillBy` | `'generator'` | `'skill'` (twelve skills share four generators) |
| `loopWeakBars` | true | false (a bar is not a breath) |
| `maxSteps` | none | the highest step of each ladder the range holds |
| `copy` | `GUITAR_PLANNER_COPY` | `VOICE_PLANNER_COPY` (nothing is "played", no sentence promises a slower or a faster song) |

Voice offers 10, 20 or 30 minutes. There is no 5-minute day: a voice day always opens with a warm-up, so a quick request gets the 10-minute day. The day lasts what its template adds up to, so a profile that says 45 gets the 30-minute day.

**Tempo skills** keep every rule as written in `ADAPTIVE_TRAINING.md`. One guard: `SkillDef.minTempo`. The planner stores `params.minTempo` on a block when the skill has one (guitar blocks stay byte-identical) and never plans under it; `nextRepTempo(…, minTempo)`, `adaptAfterBlock`, the warm-up factor, the comeback, the day factor and `exerciseForBlock` all hold the floor. At the floor a rough round is repeated at the floor.

**Step skills** never change tempo. A ladder replaces it, rule for rule:

| Tempo rule | Step rule |
|---|---|
| start tempo | `params.step` = the step reached (`state.step`), no higher than `maxSteps`; `params.startStep` is the same; `params.maxStep` is stored when the range stops the ladder early |
| warm-up and comeback at 0.9 x | one step easier (never under 0) |
| item difficulty by tempo | `itemDifficulty(skill, { tempo: refTempo, bonus: steps[step].bonus })`, in practice and in a check alike |
| +5 % after a clean round, 15 % cap | `nextRepStep`: accuracy >= 0.85 gives step + 1, at most one above `startStep` |
| -8 % after a rough round | accuracy < 0.75 gives step - 1 (easier, never slower) |
| -5 % after two in-between rounds | two rounds in a row on one step between 0.75 and 0.85 are followed by the step below |
| day factor | after a warm-up under 0.75, pending step blocks start one step easier |
| tempo ceiling | `state.step`: the highest step s at or below the run's with two clean, reliable runs at s or above among the last ten in 30 days opens s + 1, capped at `params.maxStep`; three counted runs in a row under 0.6 on the step reached or below give step - 1. A warm-up can raise it, never lower it |
| rating stop 75 / 89 / 100 | `applyAttempt` calls the unchanged `ratingDelta` with `{ start: 0, target: top }`, the run's `playedTempo` set to its `params.step` and the state's ceiling set to `max(0, step - 1)`, where `top` is `params.maxStep ?? steps.length - 1` |

So a gain stops 40 points above the step's difficulty, no step below the top leads past 89, and only an accurate run on the top step reaches 100. A singer with a small range can finish every skill on the highest step their voice can hold. `maxStepFor(skill, range)` is contiguous: nothing above the first step that does not fit is reachable, and a step fits when `high - low >= span`. In the smallest range the slides and the bigger jumps stop at their second step; no other ladder is cut short.

Worked caps (pinned through the real exercises in `planner.voice.test.ts`): match 50, 62, 70, then 100; hold 60, 68, 76, then 100; phrases 75, 82, then 100. The first step of "Match a note" stops short of the 60 that opens the next skills; its second step gets there.

`RepOutcome` carries `nextParams?: { step }` for a step exercise; the block runner merges it as it takes over the next tempo. A step reached for the first time is a milestone of type `tempo` with key `step:${skill.id}:${n}` and title `${skill.name}: ${label}`; the "clean at N bpm" milestone is not raised for step skills.

One planner rule only singing meets: a tier 0 skill that another skill lists as a prerequisite stays in the recap rotation, and is the warm-up of the day once it has not been practised for a week. "Match a note" would otherwise leave the plan once beginner mode ends, go rusty, and close the skills built on it. No guitar tier 0 skill is a prerequisite, so nothing changes there.

**Checks.** No starting check: the voice set-up sets `placementDoneAt` for every answer. There is no monthly check either; `finishTest` refuses a starting or monthly check for a voice before anything is stored. The weekly check is the generic `checkpointTasks` over voice skills with `voiceCheckOptions(range)`: the voice pass mark, "Sing …", at most 8 bars, tempo never under `minTempo`, step skills at their fixed tempo on the step reached and no higher than the range holds. `voiceCheckDue` asks `isTestDue({ ...profile, lastMonthlyAt: now }, now, 0)`, so it never depends on the sound-sync measurement and a monthly check is never due; a gentle day has no check (it is due again the day after). `/test/checkpoint?instrument=voice` is the only voice check; a placement or monthly check with voice active goes back to Today. The instrument of a check is read from its tasks (`instrumentOfCheck`: a task on a `voice.` skill, or a song to sing). A singer's check is worded through `CheckpointOptions.copy`: tasks are titled by what is sung ("Hot Cross Buns (Echo two lines)"), the report reads "Check: N of M done well", and its milestone "Your weekly check went well".

**Advice.** `recommendations(ctx, { instrument: 'voice' })` implies `VOICE_TEST_PASS`, one song speed and no sound-sync card. For voice there is no slower-song card, no weak-bars loop card, no tempo card under the floor, and for step skills a step card (`step-ratchet`, `step-fallback`, `test-passed-step-up`) or nothing. The Coach leaves out song runs sung before the song's key was last lowered (`runsInPresentKey`) and runs of songs it does not offer.

**Song blocks.** Every voice song block has speed 1 on every day and carries no bar loop. A song summary carries `levelDurations`, and the number of passes is fitted to the level about to be sung. A beginner's first song starts at level index 0. While the course runs a song waits for its lesson; once the course is ended on the profile the planner counts the whole course (`lessonsForSongs` in `coach.ts`), so a singer who left after lesson 5 is offered every song that fits the range and whose needs are met. On the guitar, leaving the course half way does not open the later songs.

**Skipping or leaving the course.** A singer who answers "Yes, often", or who leaves the course before its last lesson, starts with "Match a note" at the unlock rating (60) on step 1 (`seededFirstSkill`), so the tier 1 skills are open on day one. Nothing already earned is lowered. A graduate is not seeded: they are rated by what they sang in the lessons.

**Tired.** "My voice is tired" (`markVoiceTired`) marks `profile.voice.tiredOn` with the plan's date first, then skips every open block of the plan stored for that day exactly as a single skipped block is: nothing is recorded, no rating moves, and the streak, the end of the session and the check counter follow the rules for skipped blocks. That day and the day after are gentle days (`isGentleDay`): the 10-minute template, no range skills, no check, and the line "A short, gentle day, because your voice was tired." first in the plan's explanation.

**Stamps and keys.** Voice attempts, tests, song items and milestones are stamped in `coach.ts`; streak and test milestone keys get the `voice:` prefix on the way (`milestonesFor` in `voicePlan.ts`). `migrateStoredTempos` is not run when a singing day is planned.

## 7. First steps for singing

`VOICE_COURSE` (`src/lessons/voiceCourse.ts`), ten lessons of 4 to 6 minutes in the existing `Lesson` shape. A practice round is the skill's own exercise, built by its generator with the lesson's params and the singer's range, so the lesson, the daily plan and the simulation sing the same thing. Every drill: 3 rounds, pass at 0.7, the learner can always continue. Plays are `{ songId, level, speed: 1, view: 'outline' }`. A lesson with `tool` and no drill runs the tool where the guitar course runs the tuner (the guitar lesson `l02-tune` carries `tool: 'tuner'`).

| Lesson | Cards | Middle step | Song | Unlocks |
|---|---|---|---|---|
| v01-voice Meet your voice | Singing is speaking, held longer (voice-posture); You and your phone (voice-phone); It should never hurt | tool: range finder | none | |
| v02-meet Meet the note | Listen, hear it inside, then sing; Under or over the note (pitch-ladder); High voice, low voice, same note | tool: match (hear a note, find it with your voice; three notes; nothing is scored) | none | |
| v03-match Match a note | Reading the screen (voice-lanes); My turn, your turn; Breathe in the gap | voice.pitch.match, step 0, 60 | Hot Cross Buns, level 0 | |
| v04-steps Step up, step down | Next-door notes: 1, 2, 3; Keep the air going on the way down | voice.pitch.steps, 60 | Hot Cross Buns, level 1 | sing-hot-cross-buns |
| v05-words Sing the words | The open sound carries the note (voice-mouth); Breathe at the marks; Every line has its starting note | voice.pitch.echo, step 0, 72 | Hot Cross Buns, level 2 | sing-mary-lamb |
| v06-five Five notes | Up five and back; Lighter at the top; A little higher, then back down | voice.pitch.five-note, 60 | Mary Had a Little Lamb, level 0 | sing-ode-to-joy |
| v07-hold Hold it steady | Breathe low and quiet (voice-breath); Steady air, not more air; Feeling dizzy? Stop and breathe | voice.pitch.hold, step 0, 60 | Mary Had a Little Lamb, level 2 | sing-aunt-rhody |
| v08-jumps Small jumps | Skipping a note; Hear the landing note first; Land on it, without sliding | voice.interval.thirds, 56 | Ode to Joy, level 1 | sing-saints, sing-london-bridge |
| v09-slides Sliding higher, staying easy | The slide (voice-slide); Cracks are normal; Stop while it is easy | voice.range.slides, step 0, 60, then "How did the slides feel?" | When the Saints, level 1 | sing-jingle-bells, sing-twinkle |
| v10-song Your first whole song | One note to start, then it is yours; Headphones let you hear the guitar; What daily practice looks like | voice.pitch.match, step 1, 60 | the goal song, level 2 | course done |

- The goal song is picked in the set-up from `VOICE_GOAL_SONG_IDS` (Ode to Joy, When the Saints, Mary Had a Little Lamb: the course songs that fit every range). The lesson data stores Ode to Joy, and `lessonPlayFor(lesson, goalSongId)` puts the singer's own goal in its place.
- Lesson 4 drills a tier 1 skill, which ends beginner mode for a graduate, as on guitar.
- Lesson 8 sings Ode to Joy, which moves in steps all the way; its card says so and names When the Saints, which opens after it, as the song with the jumps. Closing lines name only songs that fit every range.
- "The app is a practice helper, not a voice doctor." is said once, in lesson 1's card "It should never hurt".

Course helpers: `lessonById(id)` searches both courses; `nextLessonAfter(id)` defaults to the course the lesson belongs to (`courseOfLesson`); `unlockedSongIds` and `nextAvailableLesson` take a course defaulting to `COURSE`; `taughtSkillIds` is in `unlock.ts` and `finishedLessons(instrument)` in `coach.ts`. `finishLesson` finds the course from the lesson id and ends it on that instrument's profile. `lessonVocalSong(play, singer)` in `material.ts` gives the lesson's song as the song screen would build it.

On the lesson screens (`src/features/lessons`): a singing lesson and the singing course page send a singer who is not set up to the set-up and never start the singing course themselves; they read only the profile row of their own instrument. The finish of a lesson waits until every mark of that lesson has been stored (`markQueue` in `lessonUtils.ts`), which matters where the finish comes straight after a tool (lessons 1 and 2 have no song). In lesson 1 "Not now" is only offered once easy notes are stored. A practice round keeps the range it was opened with. The result card shows the run's own tip when it has one, otherwise the skill's tips. After a counted round of slides (a chart with `voice.glide`) the screen asks "How did the slides feel?" and stores the answer at once with `recordFelt`; a lowered range applies from the next round. The lesson's song is stored as a result under level number index + 1 at speed 1, as the song page stores it. Songs wider than the range are listed under "Comes later" on the done step and on the course page. Step labels are "Find your easy notes", "Meet the note" and, for the song, "Sing".

Illustrations (each ignores handedness; one fixed aria-label that contains every word drawn in the picture): voice-posture, voice-breath, voice-phone, voice-mouth, pitch-ladder, voice-lanes, voice-slide (`src/components/diagrams/voiceScenes.tsx`).

`voiceCourse.test.ts` holds the text to its rules: ten lessons with ids v01 to v10; 2 to 4 cards; short paragraphs; at least one "If … then …" a card; every skill, generator and song exists; drill order follows the prerequisites; the sentences about songs and rounds are held to the tunes and to what the generators build; no `{left}` or `{right}`; and a list of words the copy never uses (among them bpm, rating, accuracy, rep, tier, push, belt, louder, tone deaf, wrong and every form of fail).

## 8. Screens

- **Set-up** (`/start?instrument=voice`, root `data-instrument`; `StartHere.tsx`, `wizardState.ts`). Order: welcome ("Have you sung before?" Never / A little / Yes, often), time (10, 20, 30), phone, range, song, finish. The phone step: "Stand or sit about a forearm from the phone, in a quiet room.", "Are you wearing headphones?" (sets `voiceHeadphones`), the microphone check "Say or hum anything and watch the bar move.", and, on a device whose sound delay has never been measured, the sound-sync measurement in a singer's words, which can be skipped. The range step is the range finder. The song step offers the three goal songs. The first screen has "Not now, back to guitar", which sets the switch back and writes nothing. A singer is not offered "Skip setup": every screen can be passed with one tap and the range step always leaves a range. Finish calls `startFirstSteps(toVoiceSetup(state), now, 'voice')`: profile 2, the ten lesson rows (for every answer), `installVocalSongs()`; it never writes handedness or guitar type. "Yes, often" also ends the course on the spot and seeds the first skill. The summary reads like "New to singing · easy notes G3 to D4 · 10 min a day". The guitar wizard is unchanged; `stepOrder(hasSongs, experience, instrument = 'guitar')`.
- **My voice** (`/range`, `RangePage.tsx`): the easy notes by name on a pitch ladder (`EasyNotes`), "See your note" with a live dot and a line saying whether the note is one of the easy notes, "Find my range again", "A bit lower", "A bit higher". Always visible: "Singing should never hurt. If your throat feels sore, scratchy or tired, stop for today."
- **Meet the note** (`NoteMatch.tsx`, `noteMatch.ts`; lesson 2): the app sings a note for 1.5 s, listening opens 0.3 s plus the output latency after it ends, the note is found after 1 s in tune (within 80 cents, any octave) inside 2.5 s, and after 20 s the screen says "not yet" and offers to go on. Three notes around the easy note. Nothing is scored.
- **Pitch lanes** (`VoiceLanes.ts`, same `resize` / `draw` / `width` surface as `HighwayRenderer`; `Highway.ts` untouched; the canvas keeps test id `highway`): height is pitch from `low - 2` to `high + 2`, with a faint line for every semitone; each note is a bar as long as it lasts, moving right to left to the same line as the highway's; the syllable, "la" or the note's number is drawn under the bar; a breath mark before each line; "Listen" over each of the app's turns and "Your turn" over the first line that answers it; the live dot on the line, unrounded, folded towards the note nearest in time and clamped at the lanes' edge, with a 1.5 s trail; the part of a bar sung in tune fills in; a missed bar is dimmed with an arrow pointing to where the note is (sung under = up). No word is flashed for a miss. The view shows 5 to 10 beats by width (`lanesVisibleSeconds`), not a fixed number of seconds. On a chart with `hideAnswers` the notes (and the calls, which are the same tune) are hidden columns until sung, and the heard pitch is not drawn while a cue sounds.
- **Results** (`voiceCopy.ts`): "You were on the note for N of M notes." and at most one tip. The reason that cost the most notes wins (ties: not heard, under, over, unsteady): "We could not hear you there. Move the phone a little closer." / "A little under the note. Think a bit higher and try again." / "A little over the note. Sing softer and let it settle." / "You were close to the notes. Hold each one a little longer and keep it steady." When no note was lost: "You slid up to the notes. Hear the note first, then start right on it." (never on a chart of slides), else "You sang it an octave lower. That counts." or "…higher…". A check task's tip does not ask for another go (`sungTaskTip`). Runs that do not count use the three `NOT_COUNTED_VOICE` cards. On a wide screen the Player shows no "Latency" number field under a sung chart.
- **Song page** (`/sing/:songId`, `SingPage.tsx`, `singPage.ts`): two screens, an overview and then the Player. The overview has the key card ("In your key", the song's notes and the easy notes by name, "Lower" / "Higher"), six named levels with best runs, and "Practise one line" as a choice of line. "Listen first" is the Player's own button. A song never sung opens on "Echo each line" for a beginner and on "Whole tune" for a singer who has sung before or whose course is ended (`startLevel`); after that on the level sung last; `?level=<index>` wins. The result has no stars, score or percentage. The next level is offered, and a level shown as done, from the Coach's count (perfect 1, good 0.8, mark 0.9). A whole-song run is saved through `recordSongPlay` and as a best run under level number index + 1 at speed 1; a one-line run is practice and is not saved (`savesAsResult`). "Sing again" waits for the save and never restarts the old key after a key move.
- **Library** for a singer (`LibraryPage.tsx`): built from `VOCAL_SONGS`, not from stored rows, with each song's key and levels, and songs wider than the range under "Comes later" with a kind reason. No import and no demo buttons.
- **Today** (`TodayPage.tsx`, `todayGate.ts`, `copy.ts`): the gate reads the profile of the instrument on screen and treats a row with the other id as "not read yet" (a live query answers with the old row for a moment after the switch). A singer has no set-up card. Course home tools are "Find my easy notes" and "All lessons and songs". The plan shows "Have some water nearby." under the first block, the stop line, and "My voice is tired", which asks first ("Stop for today?"). No "Quick 5 minutes" for a singer. Minutes 10 / 20 / 30.
- **Block runner** (`BlockRunner.tsx`): finds its session from the block id prefix, builds each round in the range of that moment, merges `nextParams.step` into the next round, asks how the slides felt, and runs a song block through `useVocalRunState`.
- **Lessons, progress, checks, settings**: the shared pages with the instrument's course, skills, attempts, tests and songs. The skill map takes its skills and categories from the instrument, shows "now: <step label>" for a step skill, and leaves the 0 to 100 number out for a singer in plain mode, where an opened skill shows a trend line without numbers. A sung check (`TestFlow.tsx`, `taskResult.ts`) has its own words ("Your weekly check"), holds a song task on its first ready run and leaves it out when the song cannot be made ready. Settings has a "Singing" card (easy notes, find them again, "I use headphones") and the data section of section 2.
- **Name**: "Guitar Trainer" stays; the descriptions in `index.html` and the manifest say guitar and singing.

## 9. Proof without a singer

- `src/audio/voice.ts`: `renderVoiceNotes(notes, { sampleRate, length, tail, gain, a4 })`, the guide voice. Additive harmonics, 40 ms attack and 50 ms release that both lie inside the written note (nothing sounds after a note's end, which the cue guard relies on), an added octave when the fundamental is under 110 Hz, one voice (a note that starts while another sounds takes over), deterministic. Its level and colour were chosen by the numbers; nobody has listened to them yet.
- `src/features/play/voice/virtualSinger.testutil.ts`: `sing(notes, options)`, a different model on purpose (a pulse train through three vowel formants, jitter, breath noise, consonant gaps), sharing no code with the guide voice, so the proof does not rest on the app's own timbre. It can be flat or sharp, in another octave, scoop, swing, be late or early, breathy, quiet, hold one note for the whole tune, drift, sing legato and slide.
- `simulateVoice(chart, notes, mic, options)` = the worklet's framing with the detector set as the Player sets it, then `runHeard` with a `VoiceTracker`. Cases run at 44100 and 48000 through `phoneMic`; what depends on the frame length also at 16000 and 24000.

Must score, read as the Coach reads it (`attemptPerformance(result).acc` at least 0.85, never `summary.accuracy`): in tune; an octave down; an octave up; 30 cents flat at bands 80 and 65 (perfects); a scoop; vibrato; 150 ms late; 80 ms early; consonant gaps; legato; quiet and breathy; voice over the click; latency with the setting matched; two loop passes; the guitar's reference pitch set anywhere from 430 to 450 Hz. Two cases are counted and not clean, by design: 60 cents flat at band 80 (every note good, 0.8), and 150 ms late on 4.4 notes a second (every note counts, at least 0.8).

Must not score: silence, room noise, a steady hum in the room, the click alone (no hit, verdict unscored); the scored track alone, also with the latency setting wrong by 250 ms; strummed chords alone (at most 2 notes in 30, accuracy under 0.1); the guide track alone (it scores every note, and `ownSoundHeard` is true, so the run is bleed); 60 cents flat at band 50; 120 cents flat at band 80 on eighth notes at 100 bpm; a third too high; holding the first note of an echo call into the answer.

One held note: one pitch hummed through a whole song is never a clean round (under 0.75 on every song and level) and stays under 0.5 on every song except Jingle Bells, where 26 of the 51 notes are the starting note. A hum that wobbles half way between two notes a whole tone apart stays under 0.5 with a swing of 50 cents and reaches 0.62 on Mary Had a Little Lamb with a swing of 80 at the widest band: counted, all goods, never clean.

Sweeps: `src/training/exercises/voice/voice.sim.test.ts` sings every skill's exercise (in a plain run one exercise of every skill; with `FULL_SIM=1` every step and tempo in two ranges): in tune is a clean round, 150 cents flat is far from a pass, the scored track alone is "nothing was scored" and its call is known for the app's own voice. `src/songs/vocal/vocal.sim.test.ts` sings the songs at levels 0, 2 and 5 in a low and a high voice (a plain run takes three songs that stand for the rest, `FULL_SIM=1` all ten): in tune is clean, 60 cents flat at "Whole tune" is counted and not clean, the scored track alone scores nothing, and the guide played into the microphone is known by its starting note. `src/lessons/material.voice.test.ts` sings every lesson round and lesson song in the two starting ranges. `voice.bleed.sim.test.ts` proves both speaker checks, the late cue after headphones are pulled out, and that a learner humming along a moment behind the calls is not taken for the speaker.

Through a wireless headset's rates (16 and 24 kHz): in tune, a little late, an octave down and voice over the click are clean, and the scored track alone is unscored. At 16 kHz the 128 ms window lets a singer steadily 60 cents off on eighth notes have up to 4 notes in 18 (accuracy 0.18, far from a pass), a low voice with a wide vibrato is counted but not clean, and the count-in check misses a faint speaker while the cue check still catches it.

Browser: `e2e/singer.mjs` (`npm run test:singer`) on the virtual microphone in `e2e/lib/virtualMic.mjs` (shared with `e2e/student.mjs`). It runs the hidden page `/voice-check` (`src/features/dev/VoiceCheckPage.tsx`): one round of "Match a note" step 0 in `DEFAULT_RANGES.lower` in the real Player. The takes come from `src/features/play/voice/e2eVoiceFixtures.test.ts` (run under `E2E_FIXTURES`), which scores each in Node before writing it: in tune an octave below the lanes over the speaker, 150 cents flat, the room alone, the scored track alone, the guide track alone, and in tune at pitch with headphones. The script checks that the route does not exist without the preview key, that the page shows the exercise the takes were sung for, that in tune counts with the octave line, that flat is counted with no note on pitch, that silence and the scored track alone are unscored, that the guide fed back is bleed and turns `voiceHeadphones` and the guide off, what a `devicechange` does with the guide on and off, and the detector range during and after the run. It sets `latencyMs` instead of measuring it (the student proves the measurement). `E2E_OUTPUT` moves the rendered takes and screenshots out of `e2e/output`. A walk through the whole singing side in a browser (set-up, a lesson, a song, a day's plan) is not in the script.

Stated limit: the singer is a model. Vocal fry, breaks into the light voice, subharmonics and children's voices are not covered. Folding absorbs octave jumps; dropouts cost share. The clarity gate and the shares may need retuning from real recordings.

## 10. Voice care built in

Comfortable range only: nothing is ever asked outside `low … high` (inclusive), and a builder throws rather than hand out such a chart. Never louder: when the app cannot hear, it says move the phone closer. Every session opens with a warm-up; rests are built into every exercise; rounds are at most 8 bars; holds at most 8 s, lines at most 10 s. A stop line on Today and the range screens; "My voice is tired" ends the day without penalty and the next day is gentle. "Tight" always wins over the numbers. Cracks are shown as information, never as a miss. No word of the copy says tone deaf, wrong, push or belt, and tests hold the copy to that. The app is a practice helper, not a voice doctor; it says so once.

## 11. Device checks for the owner

None of these has been done. Each needs a real phone and a real voice.

1. Export a backup, then update over real version 4 data: Today, songs, lessons, progress and yesterday's session unchanged; a guitar and a singing session can both exist on one day.
2. With `localStorage['gt.voice'] = '1'`: stay silent through a voice exercise on the bare speaker at normal volume. Expected: "Nothing was scored". No bar may fill.
3. The same with the guide on and no headphones: the notice must appear, the run must not count, and the guide must be off afterwards.
4. Sing Hot Cross Buns at levels 0 and 3 on the bare speaker, a forearm away, in a quiet room and with a TV on: do hits and "could not hear you" match what was sung? Repeat very softly and deliberately flat.
5. A low voice singing lanes set for a high voice and the reverse: notes count, the dot stays inside the lanes.
6. Wired headphones with the guide on: chords and melody audible, no notice, notes scored; which microphone iOS uses.
7. AirPods: does opening the microphone switch to call quality (16 or 24 kHz), how late do notes land, is the result usable?
8. Is the starting note audible from the phone speaker for a low voice (around A2 to E3)?
9. Range finder with a real voice: plausible edges, the croak ignored, slides hummed with closed lips accepted, the screen stays awake, under a minute, "Skip" leads to a singable default.
10. Echo cancellation on and off while holding a 6-second note and while humming softly.
11. Pitch lanes on a small iPhone, portrait and landscape: syllables readable, dot smooth, safe areas respected; the switch clear of the notch; six tabs still fit.
12. Time to open a song level ("Getting your song ready") on the oldest phone available.
13. A phone call, Siri or lock screen during a sung run: paused or partial, never saved as misses.
14. After a voice screen the guitar tuner still reads the low E and the high E.
15. A full guitar lesson, Today block and song behave as before.
16. Wired headphones pulled out in the middle of a run with the guide on: the run must end as practice. And the first run after granting the microphone, or after a headset connects, must not.
17. Update to this version while a second tab or the installed copy still has the app open.
18. Phone volume at zero: no starting note can be heard, and the app cannot know.
19. iOS microphone modes (Voice Isolation, Wide Spectrum) during a sung run.
20. How the guide voice sounds, and whether the chords at half its level leave the tune in front.

## 12. Stated limits

- No real voice and no real phone has been through any of this. The proof is a computed singer through a phone microphone model, and one exercise in Chromium.
- The detector's window is a number of samples, so at 16 kHz it is 128 ms long. There a low voice with a wide vibrato is counted but not clean, a singer steadily 60 cents off on quick notes is given a few notes, and the count-in check can miss a faint speaker. Shortening the window at low rates would change the guitar's detector as well and needs a real headset to judge.
- 150 ms late or early on 4.4 notes a second is every note good and not a clean round: the frames of the neighbouring note are counted into a note's median.
- A hum that swings 80 cents half way between two notes a whole tone apart can reach 0.62 on one song at the widest band. It is never a clean round.
- A singer with headphones on who joins the guide from its very first moment looks like the speaker, and the run is not counted.
- Strummed chords alone can score a note or two, more in a low key. It can only happen with the guide on, where a speaker makes the run bleed.
- A sung song is arranged and rendered on the main thread after the paint, apart from its chords. On a slow phone the page does not answer for that moment.
- The tunes were written from memory by two engineers and never checked against a published score.
- The guide voice's sound and the level of the chords under it were chosen by numbers, not by ear.
- A stored range never goes below MIDI 36 or above 86, and the starting ranges are two fixed octaves; a child's voice is not catered for.
- The range finder's level limits (half and twice the hum) were tuned on the model, which cannot close its lips.
- `devicechange` within 3 s of opening the microphone is ignored; whether that fits real headsets is unknown.
- The run of a sung song task that is built without saying whose it is is judged by the guitar's sound-sync rule (`reliable` false when the sync is old) before it is stamped. Song tasks rate no skill, so only the stored flag is affected.
- The song task of a sung check still says "at Level 3" in its instruction sentence; the title and the report name the level by its name.
- Backups hold no songs and no settings: "I use headphones" and the instrument switch are per device.

## 13. Where things live

| What | Files |
|---|---|
| Release flag and preview key | `src/app/features.ts` |
| Which side a row is on; skills and course per instrument | `src/training/instruments.ts` |
| Shared types | `src/training/types.ts`, `src/chart/types.ts`, `src/lessons/types.ts`, `src/db/db.ts`, `src/app/settings.ts` |
| Store: profiles, sessions, backup, reset | `src/training/store.ts`, `src/training/milestoneStore.ts`, `src/training/useTraining.ts`, `src/db/useSongs.ts` |
| The singing profile: range, key choices, tired mark | `src/training/voiceProfile.ts` |
| What the Coach does differently for a voice | `src/training/voicePlan.ts`, and the options in `planner.ts`, `assessment.ts`, `recommend.ts`, `milestones.ts`, `learner.ts`, `coach.ts` |
| Skills and exercises | `src/training/voiceSkills.ts`, `src/training/exercises/voice/` (`builder.ts`, `voiceEcho.ts`, `voiceHold.ts`, `voicePattern.ts`, `voiceSlide.ts`), `src/training/exercises/backing.ts` |
| Keys and patterns | `src/music/keys.ts` |
| Scoring | `src/features/play/runTracker.ts`, `src/features/play/voice/` (`judge.ts`, `voiceEar.ts`, `voiceTracker.ts`, `simulateVoice.ts`) |
| Player rules and words that differ | `src/features/play/playerLabels.ts`, `laneRenderer.ts`, `runVerdict.ts`, `voice/voiceCopy.ts` |
| Pitch lanes | `src/features/play/voice/VoiceLanes.ts` |
| Guide voice | `src/audio/voice.ts` |
| Songs to sing | `src/songs/vocal/` (`tunes/`, `types.ts`, `levels.ts`, `arrange.ts`, `render.ts`, `install.ts`, `useVocalRun.ts`) |
| Course | `src/lessons/voiceCourse.ts`, `course.ts`, `material.ts`, `finish.ts`, `store.ts`; drawings in `src/components/diagrams/voiceScenes.tsx` |
| Range finder, "My voice", "Meet the note" | `src/features/voice/` |
| Song page | `src/features/sing/` |
| Set-up and the shell's door | `src/features/onboarding/`, `src/app/AppLayout.tsx` |
| Today and the block runner | `src/features/today/` |
| Checks, progress, settings | `src/features/test/`, `src/features/progress/`, `src/features/settings/` |
| Proof | `src/features/play/voice/*.test.ts`, `virtualSinger.testutil.ts`, `e2eVoiceFixtures.test.ts`, `src/training/exercises/voice/voice.sim.test.ts`, `src/songs/vocal/vocal.sim.test.ts`, `src/lessons/material.voice.test.ts`, `src/features/dev/VoiceCheckPage.tsx`, `e2e/singer.mjs`, `e2e/lib/virtualMic.mjs` |

Some comments in the code cite this document by paragraph numbers it no longer has. Where those rules are now: §12.10 (timing never fails a sung check) is in section 3 under "Results"; §12.12, §12.13, §12.14, §12.16 and §12.18 (steps the range cannot hold, the day factor for step skills, checks, song blocks, skipping the course) are in section 6 under "How each Coach rule applies"; §12.21 (not set up yet) is in section 2 under "Switch and routes"; 13.11 (the pitch standard) is in sections 1 and 3.
