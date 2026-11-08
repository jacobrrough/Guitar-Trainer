import { describe, expect, it } from 'vitest'
import { exportFileName, formatError, importStatusText } from './dataSection'

describe('dataSection helpers', () => {
  it('builds a dated export file name', () => {
    expect(exportFileName(new Date(2026, 0, 5, 23, 59))).toBe('guitar-trainer-training-2026-01-05.json')
    expect(exportFileName(new Date(2026, 10, 18))).toBe('guitar-trainer-training-2026-11-18.json')
  })

  it('describes import counts', () => {
    expect(importStatusText({ attempts: 12, skills: 3 })).toBe('Imported 12 attempts and 3 skill ratings.')
    expect(importStatusText({ attempts: 1, skills: 1 })).toBe('Imported 1 attempt and 1 skill rating.')
  })

  it('formats errors', () => {
    expect(formatError(new Error('bad file'))).toBe('bad file')
    expect(formatError('oops')).toBe('oops')
    expect(formatError(42)).toBe('Something went wrong.')
    expect(formatError(new Error(''))).toBe('Something went wrong.')
  })
})
