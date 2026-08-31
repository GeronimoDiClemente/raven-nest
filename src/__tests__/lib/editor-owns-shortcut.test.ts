// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { isInsideCodeEditor } from '../../lib/editor-owns-shortcut'

describe('isInsideCodeEditor — quién se queda con el atajo', () => {
  // Bug: el listener de App corre en fase de CAPTURA, así que Ctrl+F abría la
  // búsqueda global de Nest y, como no corta la propagación, el evento seguía
  // hasta Monaco que abría su Find encima. Dentro del editor el atajo es suyo.
  it('reconoce un target dentro del editor', () => {
    const editor = document.createElement('div')
    editor.className = 'monaco-editor'
    const inner = document.createElement('textarea')
    editor.appendChild(inner)
    document.body.appendChild(editor)
    expect(isInsideCodeEditor(inner)).toBe(true)
  })

  it('un target fuera del editor no se lo queda', () => {
    const other = document.createElement('div')
    document.body.appendChild(other)
    expect(isInsideCodeEditor(other)).toBe(false)
  })

  it('tolera target nulo o no-elemento', () => {
    expect(isInsideCodeEditor(null)).toBe(false)
    expect(isInsideCodeEditor(document)).toBe(false)
  })
})
