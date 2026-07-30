# Design — Analytics por-empleado (coaching drill-down)

Fecha: 2026-07-30 · Rama: `review/hub-stats` · Estado: aprobado (mockup OK), pendiente review del spec.

> **UI copy: TODO en inglés** (el app ya está i18n'd a inglés — commit `2c93a33`). Los strings
> de ejemplo en este spec están en inglés; la prosa está en español.

## 1. Contexto y motivación

El tab **Teams → Stats** hoy muestra solo métricas **agregadas** del equipo (el pivot `37e305b`
sacó a propósito el ranking por-dev). Un manager quiere, además, **entrar a un empleado y ver
cómo viene** de cara a un 1:1: si avanza o bajó, en qué anda, si está trabado, y qué tocó.

Esto reintroduce la dimensión por-persona, pero con un encuadre distinto al que se descartó:
**drill-down de coaching** (visibilidad para ayudar), **no** un leaderboard competitivo. La
diferencia se materializa en el orden y las señales (ver §3).

Dato clave de costo: `useTeamStats` **ya calcula datos por-dev** (`developers: DeveloperStats[]`
con commits/PRs/reviews/daily por login); el detalle a nivel de archivos viaja **anidado** en el
mismo query GraphQL de PRs (medido: **1 punto** con o sin `files`). O sea la mayor parte es
destapar data que ya existe + un fetch lazy barato.

## 2. Goals / Non-goals

**Goals**
- Que un leader elija a un miembro y vea su vista de coaching: tendencia, WIP, señales de
  trabado, PRs recientes, y áreas tocadas.
- Reusar el agregado por-dev existente; sumar solo un fetch lazy por-empleado.

**Non-goals**
- No es un ranking/scoreboard (sin número de rank, sin orden por output desc).
- No es auditoría forense a nivel de cada archivo/línea; "top áreas" es un agregado por directorio.
- No cubre commits directos a `main` sin PR para el nivel-archivo (ver §7, limitación conocida).

## 3. UX

### 3.1 Lista de miembros (en el tab Stats, debajo del agregado)
- Fila por **miembro del roster del team** (no solo los con actividad — que alguien esté quieto
  es señal). Columnas: avatar · name + `@login` · mini-actividad (`N commits · M PRs`) ·
  **trend** vs su propio período anterior (▲/▼/— con verde/rojo/muted) · **attention chip**.
- **Orden = "necesita atención" primero**, luego alfabético. **Sin número de rank.**
- Attention chip (en inglés):
  - `PR stuck 5d` (ámbar) — tiene un PR abierto estancado / sin actividad N días.
  - `Quiet — activity down` (ámbar) — caída fuerte de actividad vs su propio período.
  - `2 PRs awaiting your review` (azul) — tiene PRs esperando review del que mira.
  - sin chip si no hay señal.
- Miembro sin `github_login` linkeado → fila atenuada con `No GitHub linked` (sin métricas).
- Click en la fila → abre el drawer (§3.2). Gate: **solo leaders** (mismo que Stats hoy).

### 3.2 Drawer de drill-down (panel lateral derecho)
Secciones (copy en inglés):
1. **Header**: avatar, name, `@login`, dot online/last-active.
2. **Trend — this week vs last**: dos mini-cards (Commits, PRs merged) con delta ▲/▼ vs el
   período anterior + sparkline diario (reusa `DeveloperStats.dailyCommits`). Línea de lectura
   (una frase de contexto, ej: "Activity down and a PR stuck 5 days waiting on review").
3. **Working on now (N open PRs)**: sus PRs **abiertos** en la ventana — title, repo, edad,
   estado de review. Acá salen las señales de trabado (`open 5d · awaiting review`, ámbar).
4. **Recently merged**: sus PRs mergeados recientes — title, size chip (S/M/L/XL), `+add/−del`,
   repo, cuándo.
5. **Top areas touched**: barras horizontales de directorios (agrupando `files.path` a los
   primeros 1–2 niveles) por líneas cambiadas (add+del) de sus PRs de la ventana.

### 3.3 Consistencia con Nest (estética + comportamientos) — requisito explícito
El feature **usa el design system y los patrones existentes de Nest**, no algo bespoke:
- **Tokens/estilos**: `--raven-blue`, `--bg-app/surface/elevated`, `--border`, `--text-*`, y los
  colores de PR size (S `#22C55E` / M `#0066FF` / L `#FFB800` / XL `#FF4500`). La lista y las
  cards heredan el look de `.ts-card` / `.ts-overview-row` del tab Stats.
- **Componentes reusados**: el `DeltaBadge` que ya vive en `TeamStats.tsx` (▲/▼ vs período), el
  patrón de avatar + presence dot del sidebar de Presence, los size chips, y los estados
  `ts-empty` / `ts-warning`.
- **Drawer**: sigue el patrón de overlay/panel existente (estilo `.confirm-overlay` / paneles del
  app): backdrop semitransparente, cierre por **click-afuera** y **`Esc`**, foco manejado como en
  los modales actuales. Sin CSS aparte.
- **Comportamientos**: el **period toggle (Week/Month)** es el mismo estado que el agregado (uno
  solo, sin re-fetch — igual que hoy en `useTeamStats`); navegación/foco consistentes con los
  paneles actuales.

## 4. Datos

### 4.1 Reuso (sin costo nuevo)
Del `useTeamStats` existente: por cada `login`, commits/PRs merged/reviews/`dailyCommits` +
el período anterior (para el delta). Sirve para la lista y la sección Trend.

### 4.2 Fetch lazy por-empleado (al abrir el drawer)
Un hook nuevo `useEmployeeDetail(repos, githubToken, login, windowDays)` que dispara **solo
cuando hay un `login` seleccionado**. Query GraphQL vía `search`:

```graphql
search(query: "author:LOGIN is:pr updated:>=SINCE repo:o1/r1 repo:o2/r2 ...", type: ISSUE, first: 50) {
  nodes { ... on PullRequest {
    number title state createdAt mergedAt additions deletions
    repository { nameWithOwner }
    files(first: 100) { nodes { path additions deletions } }
    reviews(first: 20) { nodes { author { login } submittedAt state } }
  } }
}
```

- Scope: se agregan `repo:owner/name` por cada repo del team (bound al team).
- Trae PRs **abiertos + mergeados** del período en un solo query (~1–2 puntos GraphQL).
- De ahí: `Working on now` (state OPEN + señales), `Recently merged` (state MERGED), y
  `Top areas` (agregando `files`).
- Falla del fetch → error dentro del drawer; el agregado del equipo no se afecta.

## 5. Componentes (aislados)

- **`useEmployeeDetail`** (hook nuevo): fetch lazy; devuelve `{ openPrs, mergedPrs, topAreas, loading, error }`.
- **`TeamMemberList`** (componente): la lista; recibe roster + agregado por-dev + presence; emite `onSelect(login)`.
- **`EmployeeDetailPanel`** (componente): el drawer; recibe el miembro + `useEmployeeDetail`.
- **Funciones puras (TDD)** en un lib:
  - `topAreasFromFiles(prs): Array<{ dir: string; lines: number }>` — agrega `files.path` → top dirs.
  - `stuckSignals(openPrs, now): { stuck: boolean; awaitingReview: boolean; ageDays }` por PR.
  - `attentionFor(dev, openPrs, viewerLogin): { cls, text } | null` — decide el chip de la lista.
  - `trendVsPrev(dev): { commitsDelta, prsDelta }` — deltas vs período anterior.

Mapeo miembro→`github_login`: desde `profiles.github_login` / presence (ya disponible en Teams).

## 6. Testing

- **TDD** de las 4 funciones puras (§5) con inputs armados a mano (sin red).
- El fetch (`useEmployeeDetail`) es IO: verificar con **data real** vía `gh api graphql` (como en
  la migración de stats) contra un repo real, comprobando que `files`/`state` vienen y que
  `topAreas` da números sensatos.
- Suite completa verde + tsc en baseline antes de cerrar.

## 7. Edge cases / limitaciones conocidas

- **Nivel-archivo solo de PRs**: commits directos a `main` sin PR no aportan `files` barato →
  "Top areas" refleja trabajo que pasó por PR. Aceptable si el equipo labura por PR; documentarlo
  en la UI con un hint discreto si hace falta.
- `files(first: 100)` capea 100 archivos por PR (suficiente para el agregado; PRs gigantes se
  truncan — no afecta el ranking de directorios).
- `search` scope: se listan los `repo:` del team; si el team tiene muchísimos repos, el query
  string crece (bound razonable; paginar/limitar si hiciera falta).
- Miembros sin GitHub linkeado: fila `No GitHub linked`, sin drill-down.
- Acceso: **leaders only** (consistente con el gate actual de Stats).

## 8. Fuera de alcance (posible follow-up)
- Exportar/compartir la vista de un empleado.
- Ventanas custom (hoy 7/30, igual que Stats).
- Señales sobre commits directos a main (requeriría otra fuente de datos).
