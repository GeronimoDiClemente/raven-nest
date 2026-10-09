import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * `npx nest-memory` en Linux y en Mac ejecuta el archivo del `bin` DIRECTO: sin la línea
 * `#!/usr/bin/env node`, el sistema se lo da a sh y revienta en `"use strict";` con
 * «syntax error near unexpected token». En Windows no se ve, porque npm arma un `.cmd` que
 * llama a node igual — por eso el paquete se probó entero en Windows y nunca arrancó en
 * otro lado. Encontrado instalando el tarball en el Ubuntu de WSL (2026-10-09).
 */
describe('el ejecutable del paquete portátil', () => {
  const raiz = join(__dirname, '..', '..')
  const pkg = JSON.parse(readFileSync(join(raiz, 'packages', 'nest-memory', 'package.json'), 'utf8')) as {
    bin: Record<string, string>
  }

  it('el bin apunta a la entrada que compila el tsconfig del paquete', () => {
    expect(pkg.bin['nest-memory']).toBe('./dist/cli-del-paquete.js')
  })

  it('la entrada empieza con el shebang de node, que tsc conserva en el build', () => {
    const fuente = readFileSync(join(raiz, 'electron', 'cli-del-paquete.ts'), 'utf8')
    expect(fuente.startsWith('#!/usr/bin/env node\n')).toBe(true)
  })
})
