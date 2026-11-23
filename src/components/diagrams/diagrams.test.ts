import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { IllustrationId } from '../../lessons/types'
import { stringColor } from '../../music/strings'
import { ChordBox, FretboardSpot, ILLUSTRATION_LABELS, Illustration } from './index'

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

function dots(markup: string) {
  const out: Array<{ string: number; fret: number; finger: number; cx: number }> = []
  for (const m of markup.matchAll(/<circle [^>]*data-string="(\d+)"[^>]*>/g)) {
    const tag = m[0]
    const num = (k: string) => Number(new RegExp(`${k}="([\\d.]+)"`).exec(tag)![1])
    out.push({ string: num('data-string'), fret: num('data-fret'), finger: num('data-finger'), cx: num('cx') })
  }
  return out
}

const GUITAR_IDS: IllustrationId[] = ['sitting', 'pick-grip', 'fretting-hand', 'anatomy', 'string-names', 'tuning-pegs', 'strum-down', 'phone-placement']
const VOICE_IDS: IllustrationId[] = ['voice-posture', 'voice-breath', 'voice-phone', 'voice-mouth', 'pitch-ladder', 'voice-lanes', 'voice-slide']

const labelOf = (id: IllustrationId) => (ILLUSTRATION_LABELS as Record<string, string | undefined>)[id]
const draw = (id: IllustrationId, handedness: 'right' | 'left') => render(createElement(Illustration, { id, handedness }))
/** Every aria-label in the markup, in order. Labels hold no quotes or apostrophes, so the attribute is the label itself. */
const ariaLabels = (markup: string) => [...markup.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1])
const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]
/** Every <text> as [attributes, words]. Markup nested in a caption (a tspan around some of its words) is dropped, so no caption can hide from the rules below. */
const texts = (markup: string) => [...markup.matchAll(/<text([^>]*)>([\s\S]*?)<\/text>/g)].map((m) => [m[1], m[2].replace(/<[^>]*>/g, '')] as const)
/** The words drawn inside the picture. A screen reader never reads these: role="img" hides them behind the label. */
const drawnWords = (markup: string) => texts(markup).map(([, words]) => words)
/** True when the label holds the phrase as whole words: "humming" does not read "mm" out, and "lower" does not read "low". */
const saysWords = (label: string, phrase: string) =>
  new RegExp(`(^|[^a-z])${phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(label.toLowerCase())
const MIRROR = 'scale(-1 1)'

interface Box {
  text: string
  left: number
  right: number
  top: number
  bottom: number
}

/**
 * Where each caption sits, in picture units. The width is a guess on the wide side, 0.6 em a character: the font
 * of the app draws these captions at about 0.5, but it is not bundled, so a phone uses its own, and some are wider.
 */
function captionBoxes(markup: string): Box[] {
  return texts(markup).map(([attrs, text]) => {
    const x = Number(attr(attrs, 'x'))
    const y = Number(attr(attrs, 'y'))
    const size = Number(attr(attrs, 'font-size'))
    const width = text.length * size * 0.6
    const anchor = attr(attrs, 'text-anchor')
    const left = anchor === 'end' ? x - width : anchor === 'middle' ? x - width / 2 : x
    return { text, left, right: left + width, top: y - size * 0.8, bottom: y + size * 0.2 }
  })
}

const frameOf = (markup: string) => /^<svg viewBox="0 0 (\d+) (\d+)"/.exec(markup)!.slice(1).map(Number)
const overlap = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

/** True when the straight line of a <line> tag, as thick as it is drawn, passes through the box. */
function runsThrough(lineTag: string, box: Box) {
  const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map((k) => Number(attr(lineTag, k)))
  const half = Number(attr(lineTag, 'stroke-width') ?? 1) / 2
  for (let i = 0; i <= 200; i++) {
    const x = x1 + ((x2 - x1) * i) / 200
    const y = y1 + ((y2 - y1) * i) / 200
    if (x + half > box.left && x - half < box.right && y + half > box.top && y - half < box.bottom) return true
  }
  return false
}

describe('Illustration', () => {
  for (const [id, label] of Object.entries(ILLUSTRATION_LABELS)) {
    for (const handedness of ['right', 'left'] as const) {
      it(`renders ${id} (${handedness})`, () => {
        const html = render(createElement(Illustration, { id: id as IllustrationId, handedness }))
        expect(html).toContain('role="img"')
        const expected = id === 'sitting' && handedness === 'left' ? label.replace('right leg', 'left leg') : label
        expect(html).toContain(`aria-label="${expected}"`)
      })
    }
  }

  it('dispatches chord and spot ids', () => {
    expect(render(createElement(Illustration, { id: 'chord:Em' }))).toContain('Em chord diagram')
    expect(render(createElement(Illustration, { id: 'spot:0:3' }))).toContain('6th string')
  })

  it('renders a placeholder for unknown ids', () => {
    const html = render(createElement(Illustration, { id: 'nope' as IllustrationId }))
    expect(html).toContain('nope')
    expect(html).toContain('role="img"')
  })

  it('has a label for the eight guitar drawings and the seven voice drawings, and nothing else', () => {
    expect(Object.keys(ILLUSTRATION_LABELS).sort()).toEqual([...GUITAR_IDS, ...VOICE_IDS].sort())
  })
})

describe('voice illustrations', () => {
  for (const id of VOICE_IDS) {
    it(`draws ${id} with its one fixed label`, () => {
      const label = labelOf(id)
      expect(label, `${id} has no label`).toBeTypeOf('string')
      for (const handedness of ['right', 'left'] as const) {
        const html = draw(id, handedness)
        expect(html).toContain('role="img"')
        // One label on the whole picture and none inside it; the placeholder would say "Illustration <id>" here.
        expect(ariaLabels(html)).toEqual([label])
      }
    })

    it(`draws ${id} the same for either hand`, () => {
      const right = draw(id, 'right')
      expect(draw(id, 'left')).toBe(right)
      expect(right).not.toContain(MIRROR)
      // A card that knows nothing about hands (the singing set-up) gets the same picture.
      expect(render(createElement(Illustration, { id }))).toBe(right)
    })

    it(`${id} draws no words that its label leaves out`, () => {
      const label = labelOf(id) ?? ''
      const html = draw(id, 'right')
      const words = drawnWords(html)
      // Every caption is looked at: one that the pattern above could not read would otherwise pass unseen.
      expect(words.length).toBe((html.match(/<text[\s>]/g) ?? []).length)
      for (const text of words) expect(saysWords(label, text), `"${text}" is drawn but the label does not say it`).toBe(true)
    })
  }

  it('tells a word in a label from the same letters inside another word', () => {
    expect(saysWords('A face humming mm, then singing ah', 'mm')).toBe(true)
    expect(saysWords('A face humming, then singing ah', 'mm')).toBe(false)
    expect(saysWords('Lower towards the bottom', 'low')).toBe(false)
    expect(saysWords('From a low note. Then high', 'Low')).toBe(true)
    expect(saysWords('Your easy notes', 'easy notes')).toBe(true)
  })

  it('reads the words of a caption that is drawn in pieces', () => {
    expect(drawnWords('<text x="1">your <tspan font-weight="700">voice</tspan></text><text><tspan fill="red">the line</tspan></text>')).toEqual(['your voice', 'the line'])
  })

  it('gives each drawing its own label', () => {
    const labels = VOICE_IDS.map(labelOf)
    expect(new Set(labels).size).toBe(VOICE_IDS.length)
  })

  it('writes its words in the text colour of the page, so they can be read on a light or a dark surface', () => {
    for (const id of VOICE_IDS) {
      // A <text> with no fill at all is drawn black, which is as unreadable on the dark page as yellow is on a light one.
      // A tspan may leave the colour to its caption, but may not bring its own.
      for (const [tag] of draw(id, 'right').matchAll(/<(?:text|tspan)\b[^>]*>/g)) {
        const fill = attr(tag, 'fill') ?? (tag.startsWith('<tspan') ? 'currentColor' : undefined)
        expect(fill, `${id}: ${tag}`).toBe('currentColor')
      }
    }
  })

  it('keeps every word inside the picture, with room for a wider font than ours', () => {
    for (const id of VOICE_IDS) {
      const html = draw(id, 'right')
      const [w, h] = frameOf(html)
      for (const box of captionBoxes(html)) {
        // Anything past the edge of the viewBox is cut off.
        expect(box.left, `${id}: "${box.text}" starts left of the picture`).toBeGreaterThanOrEqual(0)
        expect(box.right, `${id}: "${box.text}" ends right of the picture`).toBeLessThanOrEqual(w)
        expect(box.top, `${id}: "${box.text}" is above the picture`).toBeGreaterThanOrEqual(0)
        expect(box.bottom, `${id}: "${box.text}" is below the picture`).toBeLessThanOrEqual(h)
      }
    }
  })

  it('keeps words clear of each other and of every straight line, with room for a wider font than ours', () => {
    for (const id of VOICE_IDS) {
      const html = draw(id, 'right')
      const boxes = captionBoxes(html)
      const lines = [...html.matchAll(/<line\s[^>]*>/g)].map((m) => m[0])
      boxes.forEach((box, i) => {
        for (const other of boxes.slice(i + 1)) expect(overlap(box, other), `${id}: "${box.text}" runs into "${other.text}"`).toBe(false)
        // A pointer that starts under the last letters, or the line the learner sings on drawn through "your voice".
        for (const line of lines) expect(runsThrough(line, box), `${id}: ${line} runs through "${box.text}"`).toBe(false)
      })
    }
  })

  it('passes the class of the card on to the picture, which is how a lesson card sizes and colours it', () => {
    for (const id of VOICE_IDS) {
      const html = render(createElement(Illustration, { id, className: 'max-h-56 text-slate-200' }))
      expect(/^<svg [^>]*>/.exec(html)?.[0], id).toContain(' class="max-h-56 text-slate-200"')
    }
  })

  it('can be drawn twice on one page: no ids, no shared definitions and no styles of its own', () => {
    for (const id of VOICE_IDS) {
      // Two pictures with the same id fight over it, and a style attribute carries a colour past the palette rule below.
      expect(draw(id, 'right'), id).not.toMatch(/\sid="|url\(#|<defs\b|<use\b|<style\b|\sstyle="/)
    }
  })

  it('draws with the palette of the guitar scenes: the text colour, the accent and the ink', () => {
    const palette = ['currentColor', 'none', stringColor(1), '#0b0f14']
    for (const id of VOICE_IDS) {
      const colours = [...draw(id, 'right').matchAll(/\s(?:fill|stroke)="([^"]*)"/g)].map((m) => m[1])
      expect(colours.length, id).toBeGreaterThan(0)
      for (const colour of colours) expect(palette, `${id} uses ${colour}`).toContain(colour)
    }
  })

  it('uses plain and kind words in every label and picture', () => {
    const unkind = /wrong|fail|tone.?deaf|loud|push|belt/i
    const jargon = /\b(cents?|bpm|hz|hertz|semitones?|octaves?|pitch|rating|accuracy|tier|reps?)\b/i
    for (const id of VOICE_IDS) {
      for (const text of [labelOf(id) ?? '', ...drawnWords(draw(id, 'right'))]) {
        expect(text, id).not.toMatch(unkind)
        expect(text, id).not.toMatch(jargon)
      }
    }
  })
})

describe('guitar illustrations beside the voice ones', () => {
  it('still mirrors the drawings that depend on the strumming hand', () => {
    for (const id of ['sitting', 'pick-grip', 'fretting-hand', 'anatomy', 'strum-down'] as const) {
      expect(draw(id, 'right'), id).not.toContain(MIRROR)
      expect(draw(id, 'left'), id).toContain(MIRROR)
    }
  })

  it('still draws the other three the same for either hand', () => {
    for (const id of ['string-names', 'tuning-pegs', 'phone-placement'] as const) {
      expect(draw(id, 'left'), id).toBe(draw(id, 'right'))
    }
  })
})

describe('ChordBox', () => {
  it('draws Em with fingers 2 and 3 and open markers', () => {
    const html = render(createElement(ChordBox, { name: 'Em' }))
    const d = dots(html)
    expect(d).toHaveLength(2)
    expect(d.find((x) => x.string === 1)).toMatchObject({ fret: 2, finger: 2 })
    expect(d.find((x) => x.string === 2)).toMatchObject({ fret: 2, finger: 3 })
    expect(html.match(/>O</g)).toHaveLength(4)
    expect(html).not.toContain('>X<')
    expect(html).toContain('>Em<')
  })

  it('marks muted strings with X', () => {
    const html = render(createElement(ChordBox, { name: 'D' }))
    expect(html.match(/>X</g)).toHaveLength(2)
  })

  it('mirrors string order for left-handed players', () => {
    const r = dots(render(createElement(ChordBox, { name: 'Em' })))
    const l = dots(render(createElement(ChordBox, { name: 'Em', handedness: 'left' })))
    for (const s of [1, 2]) {
      const a = r.find((x) => x.string === s)!.cx
      const b = l.find((x) => x.string === s)!.cx
      expect(a + b).toBe(160)
      expect(a).not.toBe(b)
    }
  })
})

describe('FretboardSpot', () => {
  it('captions string 0 fret 3', () => {
    const html = render(createElement(FretboardSpot, { string: 0, fret: 3, finger: 3 }))
    expect(html).toContain('6th string')
    expect(html).toContain('3rd fret')
    expect(html).toContain('finger 3')
  })
})
