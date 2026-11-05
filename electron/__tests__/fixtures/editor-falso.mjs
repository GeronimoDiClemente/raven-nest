// "Editor" de mentira para los tests de editor-externo. Recibe el archivo en argv (último argumento).
// EDITOR_FALSO_MODO: igual (no toca nada) | valido (reescribe con EDITOR_FALSO_TEXTO) | invalido (sin frontmatter) | falla (sale con 3) | anexar.
import { readFileSync, writeFileSync } from 'node:fs'

const archivo = process.argv[process.argv.length - 1]
const modo = process.env.EDITOR_FALSO_MODO ?? 'igual'

if (modo === 'falla') process.exit(3)
if (modo === 'valido') writeFileSync(archivo, process.env.EDITOR_FALSO_TEXTO ?? '')
if (modo === 'invalido') writeFileSync(archivo, 'esto no tiene frontmatter\n')
// anexar: agrega una línea al final (prueba que el editor recibió el texto entero).
if (modo === 'anexar') writeFileSync(archivo, readFileSync(archivo, 'utf8') + 'appended by the editor\n')
