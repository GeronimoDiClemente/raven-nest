import { describe, it, expect } from 'vitest'
import { isLocalUrl } from '../../lib/is-local-url'

describe('isLocalUrl', () => {
  it.each([
    'http://localhost',
    'http://localhost:3000',
    'https://localhost',
    'https://localhost:5173/path',
    'http://127.0.0.1',
    'http://127.0.0.1:8080',
    'http://0.0.0.0',
    'http://0.0.0.0:4000',
    'http://[::1]',
    'http://[::1]:3000',
    'localhost:5173',
    'localhost',
  ])('matches local: %s', (url) => {
    expect(isLocalUrl(url)).toBe(true)
  })

  it.each([
    'https://github.com',
    'https://docs.anthropic.com',
    'http://example.com',
    'https://example.com:8080',
    'http://192.168.1.10',
    'http://10.0.0.5',
    'http://172.16.0.1',
    '',
    'not-a-url',
    'mailto:foo@bar.com',
    'ftp://localhost',
  ])('does not match: %s', (url) => {
    expect(isLocalUrl(url)).toBe(false)
  })
})
