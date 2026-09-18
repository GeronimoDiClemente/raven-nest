// La extensión de VS Code y Cursor: la puerta, no el motor.
//
// El §3.3 del spec es explícito — «empaqueta la CLI y le pone una cara». Así que acá no hay
// lógica de memoria: al activarse configura el editor que la hospeda (lo mismo que
// `nest-memory setup`) y muestra el estado que ya decide `panel-de-la-extension.ts`.
//
// **No importa `vscode`**, y no es por purismo: ese módulo sólo existe adentro del editor, así
// que importarlo haría que este archivo no se pueda ni typechequear con el resto del repo ni
// probar sin levantar VS Code. Recibe la API como parámetro, igual que todo lo demás del
// paquete portátil. El `require('vscode')` de verdad vive en cinco líneas de JavaScript
// adentro del `.vsix`, que es lo único que no se puede probar desde acá.
import { estadoDelPanel, type EntradaDelPanel, type EstadoDelPanel } from './panel-de-la-extension'
import type { ResultadoDeAplicar } from './aplicar-setup'

/** Lo poco que la extensión necesita del editor. Declarado acá para no depender de `@types/vscode`. */
export interface ApiDeVSCode {
  registrarComando(id: string, fn: (...args: unknown[]) => unknown): { dispose(): void }
  mostrarMensaje(texto: string): void
  mostrarPanel(titulo: string): { html: string }
  copiarAlPortapapeles(texto: string): Promise<void>
}

export interface DepsDeExtension {
  /** Escribe la configuración MCP del editor que la hospeda. */
  configurar(): ResultadoDeAplicar
  /** De dónde sale la memoria y qué se puede hacer con ella. */
  leerEstado(): EntradaDelPanel
}

function escapar(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * El HTML del panel.
 *
 * Sin scripts y sin nada de afuera: un panel que sólo muestra texto no necesita ejecutar
 * nada, y el contenido incluye detalles de error que escribe el SERVICIO — o sea texto que no
 * controlamos. Todo lo que viene de afuera se escapa.
 *
 * Los colores salen de las variables del editor. Un panel con fondo propio adentro de un tema
 * oscuro se ve como un bug, no como una decisión.
 */
export function htmlDelPanel(estado: EstadoDelPanel): string {
  const huella = estado.huella
    ? `<p class="huella">${escapar(estado.huella)}</p>
       <p class="pie">Compare it before authorizing from the other machine.</p>`
    : ''

  return `<!DOCTYPE html>
<meta charset="utf-8">
<style>
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 1rem 1.25rem;
    line-height: 1.5;
  }
  h1 { font-size: 1.1rem; font-weight: 600; margin: 0 0 .35rem; }
  .cuenta { font-size: 2rem; font-weight: 600; line-height: 1; margin: 0; }
  .etiqueta, .pie { color: var(--vscode-descriptionForeground); font-size: .85rem; margin: .2rem 0 1rem; }
  .huella {
    font-family: var(--vscode-editor-font-family);
    font-size: 1.15rem;
    letter-spacing: .08em;
    margin: .75rem 0 .2rem;
    color: var(--vscode-textLink-foreground);
  }
  .detalle { margin: .35rem 0 0; }
</style>
<p class="cuenta">${estado.memorias}</p>
<p class="etiqueta">${estado.memorias === 1 ? 'memory' : 'memories'} · ${escapar(estado.origen)}</p>
<h1>${escapar(estado.titular)}</h1>
<p class="detalle">${escapar(estado.detalle)}</p>
${huella}`
}

const COMANDO_STATUS = 'nest-memory.status'
const COMANDO_SETUP = 'nest-memory.setup'

function contar(r: ResultadoDeAplicar): string | null {
  if (r.fallados.length > 0) {
    return `Nest Memory could not configure this editor: ${r.fallados.map((f) => f.error).join('; ')}`
  }
  // Un aviso en cada arranque es ruido: la extensión corre siempre. Sólo se habla la primera
  // vez, que es cuando algo cambió de verdad.
  if (r.escritos.length > 0) return 'Nest Memory is set up for this editor. Your agents can read your memory now.'
  return null
}

export function activar(api: ApiDeVSCode, deps: DepsDeExtension): { dispose(): void }[] {
  const abrirPanel = () => {
    const panel = api.mostrarPanel('Nest Memory')
    panel.html = htmlDelPanel(estadoDelPanel(deps.leerEstado()))
  }

  const registros = [
    api.registrarComando(COMANDO_STATUS, abrirPanel),
    api.registrarComando(COMANDO_SETUP, () => {
      const r = deps.configurar()
      api.mostrarMensaje(contar(r) ?? 'Nest Memory was already set up for this editor.')
    }),
  ]

  // Una extensión que tira en `activate` deja al editor mostrando un error rojo por algo que
  // no le impide trabajar. Lo peor que puede pasar acá es quedarse sin memoria, así que el
  // fallo se cuenta y se sigue.
  try {
    const aviso = contar(deps.configurar())
    if (aviso) api.mostrarMensaje(aviso)
  } catch (err) {
    api.mostrarMensaje(`Nest Memory could not set itself up: ${err instanceof Error ? err.message : String(err)}`)
  }

  return registros
}
