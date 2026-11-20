import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChordBox, Illustration } from '../components/diagrams'
import { CHORD_SHAPES } from '../music/chords'
import { COURSE } from './course'
import { CHORD_FINGERS, chordFingers, fingeringSentence, forHand, stringOrdinal, type Handedness } from './fingering'

const HANDS: Handedness[] = ['right', 'left']

/** The dots of a rendered chord box: string index -> { fret, finger, x }. */
function dots(name: string, handedness: Handedness) {
  const html = renderToStaticMarkup(createElement(ChordBox, { name, handedness }))
  const out = new Map<number, { fret: number; finger: number; x: number }>()
  for (const m of html.matchAll(/<circle [^>]*data-string="(\d+)"[^>]*>/g)) {
    const num = (k: string) => Number(new RegExp(`${k}="([\\d.]+)"`).exec(m[0])![1])
    out.set(num('data-string'), { fret: num('data-fret'), finger: num('data-finger'), x: num('cx') })
  }
  return { html, dots: out }
}

const chordCards = COURSE.flatMap((l) => l.learn.filter((c) => c.illustration?.startsWith('chord:')).map((c) => ({ lesson: l, card: c, name: c.illustration!.slice('chord:'.length) })))
/** Every piece of course text a learner reads. */
const courseTexts = COURSE.flatMap((l) => [l.title, l.subtitle, l.done, l.drill?.hint ?? '', ...l.learn.flatMap((c) => [c.title, ...c.paragraphs, ...(c.mistakes ?? [])])])

describe('finger numbers: one table for the chord box, the words and the notes', () => {
  it('gives every fretted string of a taught chord a finger, and no finger twice', () => {
    for (const [name, fingers] of Object.entries(CHORD_FINGERS)) {
      const fretted = CHORD_SHAPES[name].shape.filter(([, f]) => f > 0).map(([s]) => s)
      expect(Object.keys(fingers).map(Number).sort(), name).toEqual([...fretted].sort())
      expect(new Set(Object.values(fingers)).size, name).toBe(fretted.length)
    }
  })

  it('draws each chord box with exactly those fingers, for right- and left-handed learners', () => {
    for (const name of Object.keys(CHORD_FINGERS)) {
      for (const hand of HANDS) {
        const box = dots(name, hand)
        for (const [string, fret] of CHORD_SHAPES[name].shape.filter(([, f]) => f > 0)) {
          expect(box.dots.get(string), `${name} ${hand} string ${string}`).toMatchObject({ fret, finger: CHORD_FINGERS[name][string] })
          expect(box.html).toContain(`Finger ${CHORD_FINGERS[name][string]} on string ${6 - string}, fret ${fret}.`)
        }
      }
    }
  })

  it('writes the sentence from the same table', () => {
    expect(fingeringSentence('Em')).toBe('Press the 5th string at fret 2 with finger 2, and the 4th string at fret 2 with finger 3.')
    for (const name of Object.keys(CHORD_FINGERS)) {
      for (const [string, fret] of CHORD_SHAPES[name].shape.filter(([, f]) => f > 0)) {
        expect(fingeringSentence(name), name).toContain(`the ${stringOrdinal(string)} string at fret ${fret} with finger ${chordFingers(name)[string]}`)
      }
    }
  })

  it('every chord card tells the learner the fingers its chord box shows', () => {
    expect(chordCards.map((c) => c.name)).toEqual(expect.arrayContaining(['Em', 'Am', 'D', 'A', 'G', 'C', 'D7']))
    for (const { lesson, card, name } of chordCards) {
      const text = card.paragraphs.join(' ')
      // The Em box on the "changing chords" card is there for comparison; its fingers are named on the card before.
      if (!/Press the/.test(text)) {
        expect(COURSE.filter((l) => l.number <= lesson.number).flatMap((l) => l.learn).some((c) => c.paragraphs.join(' ').includes(fingeringSentence(name))), `${lesson.id} ${card.title}`).toBe(true)
        continue
      }
      expect(text, `${lesson.id} ${card.title}`).toContain(fingeringSentence(name))
      const box = dots(name, 'right')
      for (const [string, dot] of box.dots) expect(text, `${lesson.id} ${card.title}`).toContain(`the ${stringOrdinal(string)} string at fret ${dot.fret} with finger ${dot.finger}`)
    }
  })

  it('G is taught with fingers 2, 1 and 3, in the box and in the words', () => {
    const g = chordCards.find((c) => c.name === 'G')!
    expect(g.card.paragraphs.join(' ')).toContain('the 6th string at fret 3 with finger 2, the 5th string at fret 2 with finger 1, and the 1st string at fret 3 with finger 3')
    expect([...dots('G', 'right').dots].map(([s, d]) => [s, d.finger])).toEqual([[0, 2], [1, 1], [5, 3]])
  })
})

describe('left-handed learners read what their mirrored pictures show', () => {
  it('swaps the marked words for a left-handed learner and leaves the rest alone', () => {
    expect(forHand('on your {right} thigh, pointing to your {left}', 'right')).toBe('on your right thigh, pointing to your left')
    expect(forHand('on your {right} thigh, pointing to your {left}', 'left')).toBe('on your left thigh, pointing to your right')
    expect(forHand('no sides here', 'left')).toBe('no sides here')
  })

  it('no course text says left or right without marking it', () => {
    for (const text of courseTexts) expect(text.replace(/\{(left|right)\}/g, ''), text).not.toMatch(/\b(left|right)\b/i)
    for (const l of COURSE) for (const text of [l.title, l.subtitle, l.done]) expect(text, text).not.toMatch(/[{}]/)
    for (const text of courseTexts) for (const hand of HANDS) expect(forHand(text, hand), text).not.toMatch(/[{}]/)
  })

  it('lesson 1 puts the guitar on the leg the drawing shows', () => {
    const card = COURSE[0].learn.find((c) => c.illustration === 'sitting')!
    for (const hand of HANDS) {
      const picture = renderToStaticMarkup(createElement(Illustration, { id: 'sitting', handedness: hand }))
      const leg = /aria-label="[^"]*resting on the (left|right) leg/.exec(picture)![1]
      const text = card.paragraphs.map((p) => forHand(p, hand)).join(' ')
      expect(leg, hand).toBe(hand)
      expect(text, hand).toContain(`on your ${leg} thigh`)
      expect(text, hand).toContain(`your ${leg} forearm`)
      expect(text, hand).toContain(`to your ${leg === 'right' ? 'left' : 'right'}.`)
    }
  })

  it('lesson 5 counts the strings from the side the chord box puts the thickest string on', () => {
    const tip = COURSE[4].learn[0].mistakes!.find((m) => /count from the thickest/.test(m))!
    for (const hand of HANDS) {
      const box = dots('Em', hand).dots
      // In Em the 5th string (index 1) is thicker than the 4th (index 2).
      const side = box.get(1)!.x < box.get(2)!.x ? 'left' : 'right'
      expect(forHand(tip, hand), hand).toContain(`on the ${side}.`)
    }
  })
})
