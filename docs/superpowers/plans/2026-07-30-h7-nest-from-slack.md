# H7 — @Nest desde Slack (Socket Mode) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development o superpowers:executing-plans. Steps con checkbox `- [ ]`.

**Goal:** Recibir menciones `@Nest` y clicks de botones desde Slack por Socket Mode, y convertirlos en worktree+agente local con updates al thread.

**Architecture:** Cliente Socket Mode en main (`slack-socket.ts`) con WebSocket inyectable (testeable sin red); parseo puro de envelopes; el main NO abre panes — empuja `slack:mention`/`slack:action` al renderer por IPC push; el renderer crea worktree+pane con `initialInput` (H4) y registra `pane→thread`; los updates al thread reusan `chat.postMessage` con `thread_ts`.

**Tech Stack:** Electron main (WebSocket global de Node — SIN dep nueva), TS, React, vitest. Slack Socket Mode + Web API.

**Spec:** `docs/superpowers/specs/2026-07-30-h7-nest-from-slack-design.md`. Depende de H4 (`initialInput`/pane), H5 (notify/`chat.postMessage`).

**Sin app Slack con Socket Mode en el entorno → NO se testea en vivo; cobertura por unit tests con WebSocket fake + fetch mock.**

---

## File Structure
- Create: `electron/integrations/slack-envelopes.ts` — parseo puro (parseEnvelope/extractMention/extractAction/ackFrame).
- Create: `electron/integrations/slack-socket.ts` — cliente Socket Mode (connect/ack/dispatch/reconnect) con `wsFactory` inyectable.
- Create: `electron/__tests__/slack-envelopes.test.ts`, `electron/__tests__/slack-socket.test.ts`.
- Modify: `electron/main.ts` — arrancar socket si hay app token; rutear a IPC push; postear al thread.
- Modify: `electron/preload.ts` — `window.slackMentions`.
- Modify: `src/App.tsx` — consumir `slack:mention`/`slack:action`; mapa `pane→thread`.
- Modify: `src/types.ts` — tipos del bridge.

---

## Task 1: Parseo puro de envelopes

**Files:** Create `electron/integrations/slack-envelopes.ts`; Test `electron/__tests__/slack-envelopes.test.ts`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest'
import { parseEnvelope, ackFrame } from '../integrations/slack-envelopes'

describe('slack envelopes', () => {
  it('app_mention → mention con channel/thread/user/text limpio (sin la mención)', () => {
    const env = { type: 'events_api', envelope_id: 'e1', payload: { event: {
      type: 'app_mention', channel: 'C1', ts: '111.1', thread_ts: '110.0', user: 'U9',
      text: '<@UBOT> arreglá el build',
    } } }
    const out = parseEnvelope(env)
    expect(out).toEqual({ kind: 'mention', envelopeId: 'e1',
      mention: { channel: 'C1', threadTs: '110.0', user: 'U9', text: 'arreglá el build' } })
  })

  it('app_mention sin thread_ts usa el ts del mensaje como thread', () => {
    const env = { type: 'events_api', envelope_id: 'e2', payload: { event: {
      type: 'app_mention', channel: 'C1', ts: '111.1', user: 'U9', text: '<@UBOT> hola' } } }
    expect((parseEnvelope(env) as { mention: { threadTs: string } }).mention.threadTs).toBe('111.1')
  })

  it('block_actions → action con actionId/value/channel/thread', () => {
    const env = { type: 'interactive', envelope_id: 'e3', payload: {
      type: 'block_actions', user: { id: 'U9' },
      channel: { id: 'C1' }, message: { thread_ts: '110.0' },
      actions: [{ action_id: 'fix_ci', value: '/wt/x' }] } }
    expect(parseEnvelope(env)).toEqual({ kind: 'action', envelopeId: 'e3',
      action: { actionId: 'fix_ci', value: '/wt/x', channel: 'C1', threadTs: '110.0', user: 'U9' } })
  })

  it('hello/disconnect/desconocido → kind control', () => {
    expect(parseEnvelope({ type: 'hello' }).kind).toBe('control')
    expect(parseEnvelope({ type: 'disconnect', envelope_id: 'x' }).kind).toBe('control')
  })

  it('ackFrame serializa {envelope_id}', () => {
    expect(JSON.parse(ackFrame('e1'))).toEqual({ envelope_id: 'e1' })
  })
})
```

- [ ] **Step 2:** Run `npx vitest run electron/__tests__/slack-envelopes.test.ts` → FAIL.

- [ ] **Step 3:** Implementar. `parseEnvelope(env)` devuelve una unión discriminada por `kind`:
  - `events_api` + `payload.event.type==='app_mention'` → `{ kind:'mention', envelopeId, mention:{ channel, threadTs: event.thread_ts ?? event.ts, user, text: stripMention(event.text) } }`. `stripMention` quita el primer `<@...>` y trimea.
  - `interactive` + `payload.type==='block_actions'` → `{ kind:'action', envelopeId, action:{ actionId: payload.actions[0].action_id, value: payload.actions[0].value, channel: payload.channel.id, threadTs: payload.message?.thread_ts, user: payload.user.id } }`.
  - resto → `{ kind:'control', envelopeId?, control: env.type }`.
  - `ackFrame(id)` → `JSON.stringify({ envelope_id: id })`.

- [ ] **Step 4:** Run → PASS. **Commit** `git commit -m "feat(h7): parseo puro de envelopes de Socket Mode (mention/action/control)"`

---

## Task 2: Cliente `SlackSocket` (connect + ack + dispatch + reconnect)

**Files:** Create `electron/integrations/slack-socket.ts`; Test `electron/__tests__/slack-socket.test.ts`.

WebSocket inyectable: `wsFactory: (url) => WsLike` (default `(url) => new WebSocket(url)`), donde `WsLike = { addEventListener(type, cb); send(data); close() }` (API browser-like del WebSocket global de Node).

- [ ] **Step 1: Failing test** (con fetch mock + WS fake)

```ts
import { SlackSocket } from '../integrations/slack-socket'

function fakeWs() {
  const handlers: Record<string, ((ev: unknown) => void)[]> = {}
  return {
    sent: [] as string[],
    addEventListener: (t: string, cb: (ev: unknown) => void) => { (handlers[t] ??= []).push(cb) },
    send(d: string) { this.sent.push(d) },
    close() { (handlers['close'] ?? []).forEach((cb) => cb({})) },
    emit(msg: unknown) { (handlers['message'] ?? []).forEach((cb) => cb({ data: JSON.stringify(msg) })) },
    open() { (handlers['open'] ?? []).forEach((cb) => cb({})) },
  }
}

it('connect abre la url de apps.connections.open y ACKea + dispatcha una mención', async () => {
  const ws = fakeWs()
  const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, url: 'wss://x' }), { status: 200 }))
  const onAppMention = vi.fn()
  const sock = new SlackSocket({
    appToken: 'xapp-1', fetch: fetch as unknown as typeof globalThis.fetch,
    wsFactory: () => ws, onAppMention, onBlockAction: vi.fn(),
  })
  await sock.connect()
  ws.emit({ type: 'events_api', envelope_id: 'e1', payload: { event: {
    type: 'app_mention', channel: 'C1', ts: '1.1', user: 'U9', text: '<@B> hola' } } })
  expect(JSON.parse(ws.sent[0])).toEqual({ envelope_id: 'e1' })          // ACK
  expect(onAppMention).toHaveBeenCalledWith(expect.objectContaining({ channel: 'C1', text: 'hola' }))
})

it('reconecta cuando el socket se cierra', async () => {
  const wss = [fakeWs(), fakeWs()]
  let i = 0
  const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, url: 'wss://x' }), { status: 200 }))
  const sock = new SlackSocket({ appToken: 'xapp-1', fetch: fetch as unknown as typeof globalThis.fetch,
    wsFactory: () => wss[i++], onAppMention: vi.fn(), onBlockAction: vi.fn() })
  await sock.connect()
  wss[0].close()                       // dispara reconexión
  await Promise.resolve(); await Promise.resolve()
  expect(fetch).toHaveBeenCalledTimes(2)  // re-open
})
```

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3:** Implementar `SlackSocket`:
  - `connect()`: `POST https://slack.com/api/apps.connections.open` (Bearer appToken) → `{url}`; `this.ws = wsFactory(url)`; registrar `addEventListener('message', onMessage)` y `addEventListener('close', onClose)`.
  - `onMessage(ev)`: `const env = JSON.parse(ev.data)`; si tiene `envelope_id` → `this.ws.send(ackFrame(env.envelope_id))`; `const parsed = parseEnvelope(env)`; si `kind==='mention'` → `onAppMention(parsed.mention)`; si `kind==='action'` → `onBlockAction(parsed.action)`; control → noop (salvo `disconnect` → cerrar y reconectar).
  - `onClose()`: si no fue `close()` manual → `void this.connect()` (reconexión; backoff simple opcional, no testeado). Guardá un flag `this.stopped` para `disconnect()` manual.
  - `disconnect()`: `this.stopped = true; this.ws?.close()`.

- [ ] **Step 4:** Run → PASS. **Commit** `git commit -m "feat(h7): SlackSocket — connect/ack/dispatch/reconnect con WebSocket inyectable"`

---

## Task 3: Wiring en main + IPC push + postear al thread

**Files:** Modify `electron/main.ts`, `electron/preload.ts`.

- [ ] **Step 1:** En `main.ts`, tras el wiring del bus: si `pluginCreds.getToken('slack-app')` existe, instanciar y conectar el socket. Los callbacks empujan al renderer:

```ts
const appToken = pluginCreds.getToken('slack-app')
if (appToken) {
  const slackSocket = new SlackSocket({
    appToken, fetch,
    onAppMention: (m) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('slack:mention', m) },
    onBlockAction: (a) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('slack:action', a) },
  })
  void slackSocket.connect().catch((e) => console.warn('[slack-socket] connect failed', e))
}
```

- [ ] **Step 2:** IPC para postear al thread (el renderer lo llama al crear la sesión y en updates):

```ts
ipcMain.handle('slack:postThread', async (_e, args: { channel: string; threadTs: string; text: string }) => {
  const token = pluginCreds.getToken('slack'); if (!token) return { ok: false }
  await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ channel: args.channel, thread_ts: args.threadTs, text: args.text }),
  })
  return { ok: true }
})
```

- [ ] **Step 3:** `preload.ts` — `window.slackMentions`: `{ onMention(cb), onAction(cb), postThread(args) }` (listeners `slack:mention`/`slack:action` con cleanup, invoke `slack:postThread`). Tipos en `src/types.ts`.

- [ ] **Step 4:** Verify: `npx vitest run` verde + typecheck node de los archivos tocados (sin errores nuevos, excluyendo pre-existentes).

- [ ] **Step 5: Commit** `git commit -m "feat(h7): wiring del socket en main + IPC slack:mention/action/postThread"`

---

## Task 4: Renderer consume mención/acción → worktree + pane + thread

**Files:** Modify `src/App.tsx`, `src/types.ts`.

- [ ] **Step 1:** En `App.tsx`, un `useEffect` que registra `window.slackMentions.onMention` y `onAction`:
  - `onMention(m)`: resolver repo destino (el activo `activeRepoPath`), `window.tickets.branchName(login, 'slack', m.text.slice(0,24))` → branch; `window.worktree.create({repoPath, branch})`; abrir pane con `initialInput = m.text` (setAddingPane `{ worktreePath, initialInput: m.text }`); registrar en un ref `paneThreadRef.current[paneId] = { channel: m.channel, threadTs: m.threadTs }` (se resuelve el paneId cuando `addPane` crea el pane); `window.slackMentions.postThread({ channel, threadTs, text: '🪺 Trabajando en esto — abrí Nest para ver el terminal.' })`.
  - `onAction(a)`: si `a.actionId==='fix_ci'` → `onFixCi(a.value)` (el prompt-fix de H4, `a.value` = worktreePath); si `a.actionId==='relaunch'` → re-inyectar al pane del worktree. ACK ya lo hizo el socket.
  - Cleanup de ambos listeners en el return del effect.

- [ ] **Step 2:** Mapa `paneThreadRef = useRef<Record<string, {channel; threadTs}>>({})`. Cuando el bus emite hitos del branch (pr.opened/ci.failed) — v1 mínimo: al crear la sesión ya se posteó; los updates por evento quedan como el enganche del paso siguiente (opcional). Mantené el registro para que un follow-up postee updates.

- [ ] **Step 3:** Verify: `npx vitest run` verde + typecheck web (excluyendo `demoMode.ts`, ver nota H4-H6). Si algún test de `App`/render existente rompe por los nuevos listeners, mockeá `window.slackMentions` en el setup de ese test (patrón: como se mockea `window.signals` tras H4).

- [ ] **Step 4: Commit** `git commit -m "feat(h7): renderer abre worktree+pane desde @Nest y postea al thread"`

---

## Self-Review (hecho)
- **Spec coverage:** Socket Mode transport (Task 2) · app_mention→sesión (Tasks 1,3,4) · block_actions→acción sobre pane (Tasks 1,4) · updates al thread (Task 3 postThread + Task 4) · ACK/reconnect (Task 2). ✅
- **Placeholders:** tests con código real; los detalles de UI (Task 4) referencian patrones ya existentes (`onFixCi` de H4, mock de `window.signals`).
- **Type consistency:** `parseEnvelope` unión `mention|action|control` usada igual en `SlackSocket`; `slack:mention`/`slack:action`/`slack:postThread` idénticos en main/preload/types.
- **Seguridad (spec §7):** el socket ya está autenticado con el app token del workspace instalado → los eventos vienen solo de ese workspace. No se abre sesión desde workspaces ajenos.
- **Nota:** los botones accionables en los mensajes de Slack (Block Kit) se envían desde un follow-up de composición de mensajes; H7 deja el CAMINO de vuelta (`block_actions`→acción) implementado y testeado. Updates al thread por evento del bus (más allá del "trabajando en esto" inicial) quedan como enganche opcional documentado.
