# Beginner experience: how the established apps do it, and what we change

Purpose of the app: take someone who has never touched a guitar to playing songs. This
document compares how Yousician, Simply Guitar, Fender Play, Rocksmith+, JustinGuitar and
Guitar Tricks handle the first hours and weeks, audits our own first-run experience, and
proposes a concrete "zero to first song" path.

Sources: official course pages, help centres and long-form reviews reached through web
search (the development sandbox cannot open arbitrary pages, so details are from search
summaries of those pages and are marked where thin). Links at the end.

---

## 1. What the established apps do with a complete novice

### 1.1 The first ten minutes

| | Setup questions | First interactive step | What happens before any music theory |
|---|---|---|---|
| **Yousician** | instrument, skill level, genre | tuner (the app listens through the mic) | a teacher video shows how to hold the guitar and how to tune; as soon as the 6th string is in tune you play it in a first "song" |
| **Simply Guitar** | own a guitar? which type? can you tune? know chords? goal, genre, the song you want to play; choose a Lead path or a Chords path | tuning, in a "Simplified" tuner where you tap the string you are tuning | intro video: what you need, how to hold it, tuning, string names; the first chord (E minor) in the first lesson |
| **Fender Play** | instrument (acoustic / electric / bass / uke), genre, then a path you can change later | "Guitar 101: First Things Fast", about 20 minutes: get familiar with the guitar, tune, play first notes | first riff (fretting single notes), then E minor and two easy chords, then a song made of them |
| **Rocksmith+** | instrument, strumming hand (left-handed), guitar type, where to start if you already play | tuning and a "can the app hear you" check, about 15 minutes of setup | one-minute tutorial videos (hold the guitar, strum, read the note highway), then open strings |
| **JustinGuitar** | none (free site / app), grades instead | Grade 1 Module 0: anatomy, holding, tuning, string names, how to practise | Module 1: A and D chords, one-minute changes, your first two-chord songs; a written 20-minute practice routine per module |
| **Guitar Tricks** | none | Guitar Fundamentals 1 | parts, tuning, holding, open chords, simple melodies (Ode to Joy), 4/4 and 3/4 strumming |

### 1.2 How they reach a song

- **Something recognisable within the first session.** Fender advertises a first riff in
  about 20 minutes; Yousician plays the first "song" the moment one string is tuned;
  Simply opens its song library after the second lesson; Justin's Module 1 ends with
  two-chord songs.
- **Songs are built from exactly what was just learned**: one-string riffs after first
  notes, two-chord songs after the first two chords. Nothing in a song is new.
- **Chords come early**, not after weeks of single notes: E minor in lesson one (Simply,
  Fender, Yousician), or A and D with timed changes (Justin). Changes are drilled with a
  clock ("one-minute changes", a target of roughly 30 changes a minute before moving on).
- **Melodies for first notes** are public-domain tunes (Ode to Joy, Jingle Bells) or
  famous one-string riffs (Smoke on the Water, Seven Nation Army).

### 1.3 Lesson shape

- **Learn, try, play.** Every lesson is a short demonstration (one-minute videos in
  Rocksmith+, 1–3 minute chord videos in Fender), then the learner tries it, then a
  practice track or song.
- **Short.** Chord and skill lessons 1–5 minutes, riffs 3–5, songs 8–10 (Fender). Justin's
  routine is 3 + 2 + 1 + 1 + 10 minutes.
- **The app plays it first** and listens while you play; feedback is immediate, per note or
  per chord, with stars or percentages at the end and gentle gating ("not yet, try again").
- **Difficulty is adjustable per song** (Rocksmith's dynamic difficulty from a few notes
  per bar to the full part) and the learner may skip ahead if the basics are too easy.
- **Visible structure and milestones**: Levels 1–5 beginner, Grades and Modules, "songs you
  can play now", streaks.

### 1.4 How they explain the physical part

Holding the guitar on the right leg, the pick grip (thumb and side of the index, a few
millimetres showing), fingertip just behind the fret, thumb behind the neck, how hard to
press, why it buzzes, why fingertips hurt and that it passes, which way to turn a tuning
peg, what the string names are and a mnemonic for them. All of it is told with a picture
or a video before the first attempt, and repeated as tips when the app hears a problem.

### 1.5 Patterns worth copying

1. A setup wizard that asks what matters: played before, acoustic or electric, left-handed,
   minutes per day, and, for motivation, a song you would like to play.
2. Tuning as the first interactive step, with a "can the app hear you" check.
3. A first recognisable tune within 20–30 minutes, built only from what was shown.
4. Chords in week one with timed changes and two-chord songs.
5. Learn, try, play: show it, let them try it with the guide playing, then play the song.
6. One- to five-minute lessons; ten-minute days are fine at the start.
7. Plain words. No numbers without meaning.
8. Pictures of hands: holding, pick, fretting, chord boxes with finger numbers.
9. Songs as the unit of progress ("you can now play 3 songs").
10. Mistakes handled with a specific tip, not a score.

---

## 2. Where we stand today

What exists: a tuner, a metronome, a note highway with mic scoring, six auto-generated
difficulty levels per song, a Coach with 27 skills and 15 drill generators including the
new tier-0 open-strings and first-frets drills, a first-steps planner mode, "Listen first",
milestones and a demo riff. What a complete novice meets, in order:

### 2.1 The first screen

The first thing a new player sees is the setup card: goals, daily minutes, a warning badge
"Not calibrated" with "Calibrating your latency first (Settings) makes test results
reliable", and a primary button "Take the placement test (~6 min)". The calibration dialog
then asks them to "strum a muted string exactly on each click". Nothing says how to hold
the guitar, which string is which, whether they play left-handed, where to put the phone,
or that the microphone is how they get scored. The install banner appears before the app
has shown any value.

### 2.2 Tuner

Six buttons labelled E A D G B E (two of them "E"), a readout like "-23 cents · 82.4 Hz ·
target 82.4 Hz", and "Green means within ±5 cents". Nothing says "pluck the thickest
string first", nothing says which way to turn the peg; "tune down/up" is ambiguous.

### 2.3 The daily session

Block titles read "Open strings on the beat · 50 bpm" and "Skill check: placement"; the
"Why this?" panel says things like "Rated 18 (novice), top priority for your goals; never
practised". Results show "Rating 12 → 18", "Rep 2 of 4", "Next rep at 55 bpm",
"timing: +40 ms (late)", "Low-confidence result: low coverage". Only the tier-0 and tier-1
tips give any physical how-to, and they use "bridge", "fret wire" and "picking hand"
without a picture.

### 2.4 The play screen

Lanes show fret numbers (or note names) with a note letter at the left edge. There are no
finger numbers, no string numbers, no fretboard or chord diagram anywhere (`music/chords.ts`
holds the shapes as data; nothing draws them), and no left-handed mode. A miss is a grey
pill saying "Miss"; the end screen is stars plus a score. The on-screen hint talks about
"the highway" and "R to restart".

### 2.5 Songs and progress

One bundled song, a synthesised demo riff. Everything else needs the player's own audio
file plus a Guitar Pro, MusicXML or MIDI chart, or an AI transcription. The Progress page
speaks of ratings, "T1", "mastered / solid / total", "provisional" and "rusty".

### 2.6 The fifteen worst blockers, smallest fix first

| # | Where | What a novice meets | Smallest fix |
|---|---|---|---|
| 1 | Setup card | "Take the placement test" is the primary action | Make "I'm new to guitar" primary; hide the test behind "I've played before" |
| 2 | Setup card | "Not calibrated" warning and latency talk | Remove from first run; default the latency, ask later only if scores look off |
| 3 | Calibration | "strum a muted string" | Skip for beginners, or "rest your fingers lightly on the strings and strum" |
| 4 | Missing | No meet-your-guitar step | A short pre-flight: hold it, pick grip, string names, left-handed, phone placement |
| 5 | Tuner | Two buttons both say "E" | "6 (thickest) E … 1 (thinnest) E" and "pluck the thickest string first" |
| 6 | Tuner | cents and Hz | Big "Too low, tighten" / "Too high, loosen"; numbers behind a toggle |
| 7 | Tuner | "tune down/up" | "loosen a little" / "tighten a little" |
| 8 | Skill tips | "bridge", "fret wire", "picking hand" | Anatomy picture; "right hand (if right-handed)"; "about 3 mm of tip" |
| 9 | Today | "· 50 bpm", "73% accuracy" | "slowly, with the clicks"; "5 of 8 notes right" |
| 10 | Block result | "Rating 12 → 18", "Low-confidence result" | "You hit 6 of 8 notes. Try again?"; no rating row for beginners |
| 11 | Rep card | "Rep 2 of 4", "+40 ms (late)", "Next rep at 55 bpm" | "Round 2 of 4", "a little behind the click", "a bit faster next time" |
| 12 | Why this? | planner prose about ratings and priority | "An easy first exercise to get your fingers used to the strings" |
| 13 | Player | "highway", "R to restart", icon-only mic | "note lane"; a visible "tap the mic to get scored" |
| 14 | Highway | fret number only | Finger numbers 1–4 on notes for first-steps content; "6th string, fret 3" wording |
| 15 | Library | import audio + chart files | Bundle public-domain tunes with synthesised backing; make importing "advanced" |

### 2.7 Words to retire from beginner-facing screens

Rating, tier/T1, provisional, rusty, Elo, placement test, calibrate latency, detection
sensitivity, clarity, octave tolerance, reference pitch A4 = 440 Hz, chart offset, bpm
(without explanation), accuracy/perfect/good/missed as the only feedback, rep, highway
look-ahead, Level 1–5/Full, weak bars, cents/Hz, chromatic/auto string, guide notes, skill
check/second skill/focus/review as block names. Replacements are in §3.

### 2.8 The three structural gaps

1. **No day-zero basics**: posture, left/right-handed, anatomy with numbered and named
   strings, pick grip, acoustic vs electric and phone placement, and a guided first tune-up
   with a plain verdict, before any session.
2. **No visual instruction for physical actions**: no fretboard or chord diagram component
   and no finger numbers, so fret numbers cannot be translated to the neck.
3. **No beginner song path**: no graded set of recognisable bundled tunes with backing, and
   feedback that is a score rather than a next step.

---

## 3. The proposal: "First steps", zero to first song

### 3.1 Principles

- **Songs are the goal and the reward.** Every lesson ends in something that sounds like
  music, built only from what the lesson taught.
- **Nothing before it is needed.** No placement test, no goals screen, no numbers until the
  learner has played a tune.
- **Show, try, play.** Each lesson is a card with a picture and three sentences, a drill
  with the guide playing first, then a song.
- **Plain language.** "Level 1: First notes", "You hit 6 of 8", "Press closer to the fret".
  Ratings, tiers and reliability stay in the engine.
- **Ten minutes a day is a win.** Default 10 minutes for new players.

### 3.2 First launch: the Start Here wizard (replaces the setup card for new players)

1. "Have you played guitar before?" Never / A little / Yes. "Yes" leads to today's setup
   with the placement test; the other two start First steps (with "A little" allowed to
   skip lessons it already knows).
2. "Which guitar?" Acoustic / Electric (sets tuner hints and mic advice). "Which hand
   strums?" Right / Left (mirrors the highway and every diagram).
3. "How long each day?" 10 / 15 / 20 minutes, default 10.
4. "Pick a song to aim for." A list of what the first course leads to (public-domain
   tunes we ship), so the first weeks have a target.
5. Phone setup: where to put the phone, why headphones help, allow the microphone, play
   any string and watch the meter move ("we can hear you").
6. Guided tuning: string by string, lowest first, big arrow saying tighten or loosen,
   a tick per string, the string's name and a mnemonic. Then straight into lesson 1.

### 3.3 The First steps course

Each lesson = **Learn** (illustrated card, three or four sentences, what can go wrong) →
**Try** (one short drill, guide plays first, mic scores) → **Play** (a tune or groove).
Three to five minutes per step; a lesson is one day for a ten-minute player.

| # | Lesson | Learn | Try (drill) | Play |
|---|---|---|---|---|
| 1 | Hold it, pick it | sitting position, pick grip, resting the hand, string names | open strings on the beat, one string then two | a two-string groove over drums |
| 2 | In tune | why tuning matters, which way to turn, how a tuner reads | guided tuning (all six strings) | the open-string groove again, now in tune |
| 3 | First frets | fingertip behind the fret, thumb behind the neck, how hard to press, buzzing | first frets 0–3 on the high E, half notes | **Ode to Joy**, first phrase, on the E and B strings |
| 4 | Crossing strings | aiming the pick, muting the string you left | open strings across all six, then two-string melodies | **Happy Birthday** or **Twinkle Twinkle** on two strings |
| 5 | Your first chord: E minor | the chord box, finger numbers, strum down slowly, check each string rings | strum E minor on the beat (chroma scoring) | a one-chord groove |
| 6 | Second chord: A minor, and changing | anchor finger, one-minute changes with a counter | Em ↔ Am changes, timed | a two-chord song (traditional, e.g. a minor-key folk tune) |
| 7 | D and A | moving a shape, the thinnest strings, strumming only the strings you need | D ↔ A changes | **Tom Dooley**-style two-chord song (G and D7 or A and D) |
| 8 | G and C, three-chord songs | the big stretch, fingertip arches | G ↔ C ↔ D changes | **Amazing Grace**, **When the Saints Go Marching In** |
| 9 | Rhythm | down-up strumming, counting, the metronome | strum patterns | the same songs with a pattern |
| 10 | Your first riff | a famous-sounding one-string riff written for the course | first riff at 60 bpm, speeding up | play it over drums, then **graduate** to the Coach's daily sessions |

After lesson 10 the Coach takes over with the existing skill graph; the first-steps skills
feed its ratings from the start, so the placement test is never needed for this path.

Songs ship as built-in, synthesised charts (public-domain melodies and traditional songs
only, rendered with the same engine as the demo): a backing with drums and the guide part,
six difficulty levels, and the "Guide notes" switch. Song pages show chord boxes above the
highway while a chord is coming.

### 3.4 Changes to the engine and UI this needs

- **Lesson content model**: lesson cards (title, illustration id, three sentences, common
  mistakes), the ordered course, and a course progress record per learner.
- **Illustrations**: a small SVG set rendered in code: sitting position, pick grip, fretting
  hand, parts of the guitar, string names, chord boxes with finger numbers, fretboard
  "where to put your finger" for the next note.
- **Highway for novices**: string names on the lanes, finger numbers on notes (chart notes
  gain an optional `finger`), slower scroll and bigger notes while in First steps,
  left-handed mirroring, a chord box shown ahead of each chord.
- **Guided tuner mode** on top of the existing tuner: string sequence, tighten/loosen arrow,
  success ticks, mnemonic.
- **Mic check** step and plain microphone advice (headphones, phone placement, speaker
  mode) in the wizard.
- **Plain-language pass** over every string a learner sees: block names, "Why this?",
  results, low-confidence notes, settings labels; an "Advanced" fold for the technical
  controls (latency, sensitivity, octave tolerance).
- **Feedback tips**: when accuracy is low the result says what to try (closer to the fret,
  let it ring, slower), chosen from the lesson's "common mistakes".
- **Timed chord changes** drill with a visible counter and a target.
- **Songs you can play now** list on Today and Progress, filled as lessons complete.
- **Default 10 minutes** and a "Quick 5" that always exists for First steps.

### 3.5 Priorities

1. Start Here wizard with mic check and guided tuning; plain-language pass; left-handed
   mirroring. (Removes the blockers that stop a novice before any music.)
2. Lessons 1–4 with cards, illustrations, finger numbers and the first two public-domain
   tunes. (Gets a never-played person to Ode to Joy in a few days.)
3. Chords: lessons 5–8, chord boxes on the highway, timed changes, two- and three-chord
   traditional songs. (Gets them to "I can play songs".)
4. Rhythm, the first riff, graduation into the Coach, the "songs you can play" list.

Each wave is a day or two of parallel agent work plus integration, in the same way the
Coach was built.

---

## 4. Links

Yousician: <https://support.yousician.com/hc/en-us/articles/204738362-Get-started-with-Yousician-guitar>,
<https://yousician.com/blog/learn-to-play-guitar>, <https://yousician.com/blog/how-to-play-guitar>,
<https://www.techradar.com/computing/websites-apps/homescreen-heroes-yousician>.
Simply Guitar: <https://www.simplyguitar.com/course-category/beginner/>,
<https://www.guitarchalk.com/simply-guitar-review/>, <https://www.guitarworld.com/reviews/simply-guitar-review>,
<https://piano-help.hellosimply.com/en/collections/3270172-get-started-with-simply-guitar>.
Fender Play: <https://www.fender.com/play/courses/guitar-101-first-things-fast/lessons/get-set-up-electric>,
<https://www.guitarworld.com/features/i-used-fender-play-for-8-weeks-to-learn-the-guitar-from-scratch-heres-how-i-got-on>,
<https://play-support.fender.com/hc/en-us/articles/44538598249755-How-long-are-the-lessons>.
Rocksmith+: <https://www.rollingstone.com/product-recommendations/electronics/rocksmith-plus-ubisoft-pc-review-1234595472/>,
<https://www.guitarworld.com/reviews/ubisoft-rocksmith-review>, <https://www.ubisoft.com/en-gb/game/rocksmith/plus/guitar-lessons>.
JustinGuitar: <https://www.justinguitar.com/modules/beginner-1-first-steps>,
<https://justinguitar.com/guitar-lessons/module-1-practice-routine-b1-116>,
<https://community.justinguitar.com/t/how-to-pass-grade-1/2478>,
<https://community.justinguitar.com/t/one-minute-changes-exercise/2367>.
Guitar Tricks: <https://guitartricks.com/beginner>, <https://www.guitarchalk.com/guitar-tricks-review/>.
