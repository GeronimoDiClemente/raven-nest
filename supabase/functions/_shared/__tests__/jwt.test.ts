import { describe, it, expect } from 'vitest'
import { jwtDelHeader } from '../jwt.ts'

describe('jwtDelHeader', () => {
  it('saca el token del Bearer; sin header o vacío, null', () => {
    expect(jwtDelHeader('Bearer abc.def.ghi')).toBe('abc.def.ghi')
    expect(jwtDelHeader('bearer   abc')).toBe('abc')
    expect(jwtDelHeader(null)).toBeNull()
    expect(jwtDelHeader('Bearer ')).toBeNull()
    expect(jwtDelHeader('Basic abc')).toBeNull()
  })
})
