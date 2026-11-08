import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { IllustrationId } from '../../lessons/types'
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
