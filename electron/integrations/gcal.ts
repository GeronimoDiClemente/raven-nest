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
import { NotConnectedError, type PanelAdapterDeps } from '../integration-panels'

const GCAL_API_BASE = 'https://www.googleapis.com/calendar/v3'

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

// ── Adapter (eventos + outcomes) ────────────────────────────────────────────

export interface GcalEvent {
  id: string
  summary?: string
  description?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  extendedProperties?: { private?: Record<string, string> }
}

/**
 * Superficie del adapter de Calendar. El handler `logOutcome` del bus depende
 * estructuralmente de `findEventByTask`/`appendOutcome`/`createOutcomeEvent`
 * (ver `GcalOutcomeSink` en bus-commands.ts); `listEvents` alimenta el panel
 * "block→session".
 */
export interface GcalAdapter {
  listEvents(timeMin: string, timeMax: string): Promise<GcalEvent[]>
  findEventByTask(taskId: string): Promise<GcalEvent | null>
  appendOutcome(eventId: string, line: string): Promise<void>
  createOutcomeEvent(summary: string, whenIso: string): Promise<GcalEvent>
}

// Fetch autenticado contra la API v3. El token (access token ya válido; el
// refresh vive en main) llega por deps. Sin token o 401 → NotConnectedError,
// igual que el resto de los adapters de panel.
async function gcalFetch<T>(
  deps: PanelAdapterDeps,
  path: string,
  init: { method?: string; body?: string } = {},
): Promise<T> {
  const token = deps.getToken('gcal')
  if (!token) throw new NotConnectedError()
  const res = await deps.fetch(`${GCAL_API_BASE}${path}`, {
    method: init.method ?? 'GET',
    body: init.body,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  if (res.status === 401) throw new NotConnectedError()
  if (!res.ok) throw new Error(`Google Calendar API error (${res.status})`)
  return (await res.json()) as T
}

export function createGcalAdapter(deps: PanelAdapterDeps): GcalAdapter {
  return {
    async listEvents(timeMin, timeMax) {
      const q = new URLSearchParams({
        timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime',
      })
      const json = await gcalFetch<{ items?: GcalEvent[] }>(deps, `/calendars/primary/events?${q.toString()}`)
      return json.items ?? []
    },
    async findEventByTask(taskId) {
      // Las extended properties privadas guardan {taskId, repo, branch} sin DB
      // extra (spec madre). El filtro es `privateExtendedProperty=taskId=<id>`.
      const q = `privateExtendedProperty=${encodeURIComponent(`taskId=${taskId}`)}`
      const json = await gcalFetch<{ items?: GcalEvent[] }>(deps, `/calendars/primary/events?${q}`)
      return json.items?.[0] ?? null
    },
    async appendOutcome(eventId, line) {
      const ev = await gcalFetch<GcalEvent>(deps, `/calendars/primary/events/${encodeURIComponent(eventId)}`)
      const prev = ev.description ?? ''
      const description = prev ? `${prev}\n${line}` : line
      await gcalFetch(deps, `/calendars/primary/events/${encodeURIComponent(eventId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ description }),
      })
    },
    async createOutcomeEvent(summary, whenIso) {
      return gcalFetch<GcalEvent>(deps, '/calendars/primary/events', {
        method: 'POST',
        body: JSON.stringify({
          summary,
          start: { dateTime: whenIso },
          end: { dateTime: whenIso },
        }),
      })
    },
  }
}
