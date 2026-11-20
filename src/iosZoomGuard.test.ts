import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * iPhones zoom the whole page when a focused field's text is under 16px. The guard against that is
 * plain CSS, so this test works out which font-size rule wins for a field on an iPhone, using the
 * real `index.html` and `index.css`, in the order the browser loads them.
 *
 * Only rules outside any `@layer` are looked at: they always beat Tailwind's own classes (which live
 * in layers), so the winner among them is the size the field gets.
 */

interface Rule {
  selector: string
  size: string
  order: number
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Index of the brace that closes the block opened at `open`. */
function blockEnd(css: string, open: number): number {
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return i
  }
  throw new Error('unbalanced braces')
}

/** Font-size rules outside any layer. `@supports` blocks are entered, as on an iPhone, where the guard's test is true. */
function fontRules(css: string, out: Rule[]): Rule[] {
  let i = 0
  while (i < css.length) {
    const brace = css.indexOf('{', i)
    const semi = css.indexOf(';', i)
    if (brace === -1) break
    if (semi !== -1 && semi < brace) {
      // A statement with no block, such as `@import "tailwindcss";`.
      i = semi + 1
      continue
    }
    const end = blockEnd(css, brace)
    const prelude = css.slice(i, brace).trim()
    const body = css.slice(brace + 1, end)
    if (prelude.startsWith('@supports')) fontRules(body, out)
    else if (!prelude.startsWith('@')) {
      let size: string | undefined
      for (const declaration of body.split(';')) {
        const [property, value] = declaration.split(':').map((part) => part.trim())
        if (property === 'font-size') size = value
        // The shorthand sets the size too.
        if (property === 'font') size = value === 'inherit' ? 'inherit' : `from shorthand: ${value}`
      }
      if (size !== undefined) for (const selector of prelude.split(',')) out.push({ selector: selector.trim(), size, order: out.length })
    }
    i = end + 1
  }
  return out
}

/** Does this selector match a bare `<tag>` (no class, id or `type`) somewhere inside html > body? */
function matches(selector: string, tag: string): boolean {
  const parts = selector.split(/\s+/)
  const last = parts[parts.length - 1].replace(/:not\(\[type="?\w+"?\]\)/g, '')
  return last === tag && parts.slice(0, -1).every((ancestor) => ancestor === 'html' || ancestor === 'body')
}

/** [attribute-level, element-level] weight, enough for the simple selectors in these two files. */
function specificity(selector: string): [number, number] {
  return [(selector.match(/\[/g) ?? []).length, selector.split(/\s+/).length]
}

function winningSize(rules: Rule[], tag: string): string | undefined {
  const candidates = rules.filter((rule) => matches(rule.selector, tag))
  candidates.sort((a, b) => {
    const [a1, a2] = specificity(a.selector)
    const [b1, b2] = specificity(b.selector)
    return a1 - b1 || a2 - b2 || a.order - b.order
  })
  return candidates[candidates.length - 1]?.size
}

describe('iPhone focus-zoom guard', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
  // The page's own <style> comes first; the stylesheet bundle is added after it.
  const inline = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
  const rules = fontRules(stripComments(`${inline}\n${css}`), [])

  it('gives every field the user types in or picks from 16px text', () => {
    expect(winningSize(rules, 'select')).toBe('16px')
    expect(winningSize(rules, 'input')).toBe('16px')
    expect(winningSize(rules, 'textarea')).toBe('16px')
  })

  it('leaves buttons at the size of the text around them', () => {
    expect(winningSize(rules, 'button')).toBe('inherit')
  })
})
