import { describe, it, expect } from 'vitest'
import { stripAnsi, hasVisibleOutput } from '../../lib/terminal-chrome'

describe('stripAnsi', () => {
  it('strips CSI color sequences', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m')).toBe('red')
  })
  it('strips carriage returns and BEL', () => {
    expect(stripAnsi('a\rb\x07')).toBe('ab')
  })
})

describe('hasVisibleOutput', () => {
  it('is true for printable text', () => {
    expect(hasVisibleOutput('hello')).toBe(true)
  })

  it('is true for text wrapped in color codes', () => {
    expect(hasVisibleOutput('\x1b[32mdone\x1b[0m')).toBe(true)
  })

  it('is true for spinner braille glyphs (a real work signal)', () => {
    expect(hasVisibleOutput('\x1b[2K⠋ Thinking')).toBe(true)
    expect(hasVisibleOutput('⠙')).toBe(true)
  })

  it('is false for empty or whitespace-only chunks', () => {
    expect(hasVisibleOutput('')).toBe(false)
    expect(hasVisibleOutput('   \n\t ')).toBe(false)
  })

  it('is false for pure ANSI control sequences (cursor/clear/reset)', () => {
    expect(hasVisibleOutput('\x1b[2K\x1b[1G')).toBe(false) // clear line + cursor to col 1
    expect(hasVisibleOutput('\x1b[?25l')).toBe(false)      // hide cursor
    expect(hasVisibleOutput('\x1b[0m')).toBe(false)        // reset attributes
  })

  it('is false for a bare carriage return (cursor repaint)', () => {
    expect(hasVisibleOutput('\r')).toBe(false)
  })

  it('is false for an OSC title update (not real work)', () => {
    expect(hasVisibleOutput('\x1b]0;my-tab\x07')).toBe(false)
  })
})
