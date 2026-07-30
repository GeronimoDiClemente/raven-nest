// Motor 4 (H6) — Google Calendar. Adapter credential-free (token vía deps, con
// refresh en main) + helpers PKCE + formateo de outcomes. La idea del spec madre:
// registrar OUTCOMES reales de las sesiones en el calendario ("45 min en RAV-123,
// 3 commits, PR #456") — la agenda miente, el registro real no. Empezamos por la
// inversa (escritura de registro); "block→session" es entrada de un click.
//
// Este módulo NO importa electron: la red/token llega SOLO por `PanelAdapterDeps`
// (getToken/fetch). El flujo OAuth (loopback + browser) vive en gcal-oauth.ts para
// aislar la lógica testeable de los efectos de servidor/shell.
import { createHash, randomBytes } from 'crypto'

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * PKCE S256 (RFC 7636). `verifier` es opcional para tests determinísticos; si no
 * se pasa, se genera uno de 32 bytes aleatorios (base64url → 43 chars). El
 * `challenge` es el SHA-256 del verifier en base64url sin padding.
 */
export function pkceChallenge(verifier?: string): { verifier: string; challenge: string } {
  const v = verifier ?? base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(v).digest())
  return { verifier: v, challenge }
}

export interface OutcomeInput {
  repo: string
  branch: string
  prNumber?: number
  commits?: number
  testsGreen?: boolean
}

/**
 * Arma la línea de outcome que se apendea a la description del evento (o se usa
 * como summary de un evento de registro). Puro y testeable. Omite las partes que
 * no vengan (commits/PR/tests son opcionales).
 */
export function formatOutcome(o: OutcomeInput): string {
  const parts = [`${o.repo} (${o.branch})`]
  if (o.commits != null) parts.push(`${o.commits} commits`)
  if (o.prNumber != null) parts.push(`PR #${o.prNumber}`)
  if (o.testsGreen != null) parts.push(o.testsGreen ? 'tests verdes' : 'tests rojos')
  return `🪺 Nest: ${parts.join(', ')}`
}
