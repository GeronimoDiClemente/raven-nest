// Siembra memorias en el store del harness para poder VER la pantalla de Memories con
// contenido real.
//
// Por qué el CLI de sqlite3 y no better-sqlite3: el binding nativo depende del ABI, y el
// proceso de Playwright corre bajo Node mientras Electron corre bajo el suyo (ver la sección
// de better-sqlite3 en CLAUDE.md). Con el binding de Node puesto, el Electron del harness no
// arranca; con el de Electron, el proceso del test no puede abrir la base. El CLI no depende
// de ninguno de los dos.
//
// Se siembra DESPUÉS de que la app arrancó, no antes: el store crea el esquema (y sus
// triggers de FTS5) al iniciarse, y estos INSERT los necesitan puestos para que la búsqueda
// encuentre lo sembrado.
import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

export interface SeedMemory {
  syncId: string
  projectKey: string
  title: string
  type: string
  /** Agrupa por tema: dos memorias con el mismo topicKey quedan unidas por una arista
   *  `topic`. */
  topicKey?: string | null
  /** Agrupa por rama: mismo valor => arista `branch`. */
  gitBranch?: string | null
  /** El logo que se ve en la fila de la lista. */
  originAi?: string | null
  /** Marca a esta memoria como reemplazada POR la del syncId dado => arista `revision`
   *  dirigida. */
  supersededBy?: string | null
  tags?: string[]
  /** Milisegundos. Default: escalonado por el orden en el array. */
  updatedAt?: number
}

/** `userId` null => cuenta local, que es con la que arranca el harness. Espeja
 *  `resolveStorePath` en electron/memory-store.ts. */
export function memoryDbPath(homeDir: string): string {
  return join(homeDir, '.raven-nest', 'memory', '_local', 'memory.db')
}

function sql(db: string, statements: string): void {
  execFileSync('sqlite3', [db, statements], { stdio: ['ignore', 'ignore', 'pipe'] })
}

function quote(v: string | null | undefined): string {
  if (v === null || v === undefined) return 'NULL'
  return `'${v.replace(/'/g, "''")}'`
}

/**
 * @returns el path de la base, para que el caller pueda afirmar sobre ella.
 * @throws si la base no existe todavía — significa que la app no terminó de arrancar, y
 * sembrar en ese caso crearía una base vacía SIN esquema que el store después no sabría
 * migrar. Fallar acá es mucho más barato que depurar eso.
 */
export function seedMemories(homeDir: string, memories: SeedMemory[]): string {
  const db = memoryDbPath(homeDir)
  if (!existsSync(db)) {
    throw new Error(
      `El store de memoria no existe todavia en ${db}. Sembrá DESPUES de que la app arranco ` +
      '(esperá a que Memories cargue una vez), no antes.',
    )
  }

  const base = 1_757_000_000_000

  const filas = memories.map((m, i) => {
    const ts = m.updatedAt ?? base - i * 3_600_000
    return `(${[
      quote(m.syncId),
      quote(m.projectKey),
      quote('project'),
      quote(m.topicKey ?? null),
      quote(m.type),
      quote(m.title),
      quote(`Contenido de ${m.title}`),
      quote(JSON.stringify(m.tags ?? [])),
      quote('e2e'),
      quote(m.originAi ?? null),
      quote(m.gitBranch ?? null),
      quote(`hash-${m.syncId}`),
      String(ts),
      String(ts),
      String(i + 1),
      quote(m.supersededBy ?? null),
    ].join(', ')})`
  })

  // La tabla `projects` es aparte de `observations`, y es la que lee `listProjects()` —
  // o sea `hubStats().projectCount`. Sin sembrarla, la pantalla dice "6 memorias across 0
  // projects", que no es un bug del producto sino del sembrado, pero se ve igual de mal en
  // una captura de evidencia.
  const proyectos = [...new Set(memories.map((m) => m.projectKey))]
  sql(db, `INSERT OR REPLACE INTO projects (project_key, display_name, enrolled, created_at)
    VALUES ${proyectos.map((k) => `(${quote(k)}, ${quote(k)}, 1, ${base})`).join(', ')};`)

  sql(db, `INSERT OR REPLACE INTO observations
    (sync_id, project_key, scope, topic_key, type, title, content, tags, source,
     origin_ai, git_branch, content_hash, created_at, updated_at, lamport, superseded_by)
    VALUES ${filas.join(',\n')};`)

  return db
}

/**
 * Un conjunto que ejercita las CUATRO clases de arista del grafo a la vez, que es lo que hace
 * falta para verificar que se distinguen entre sí:
 *
 * - `revision`: "auth por tokens" fue reemplazada por "auth por sesiones" (dirigida).
 * - `topic`:    las dos de `topic_key = 'auth'`, más la de rate limiting con su par.
 * - `branch`:   todo lo de `feat/auth` entre sí.
 * - `similar`:  se calcula por tags compartidos, así que varias comparten `auth`/`api`.
 */
export const MEMORIAS_DE_MUESTRA: SeedMemory[] = [
  {
    syncId: 'm-auth-sesiones',
    projectKey: 'raven-nest',
    title: 'Auth pasa a cookies de sesión, no tokens en localStorage',
    type: 'decision',
    topicKey: 'auth',
    gitBranch: 'feat/auth',
    originAi: 'claude',
    tags: ['auth', 'seguridad'],
  },
  {
    syncId: 'm-auth-tokens',
    projectKey: 'raven-nest',
    title: 'Auth por token en localStorage',
    type: 'decision',
    topicKey: null,
    gitBranch: 'feat/auth',
    originAi: 'claude',
    supersededBy: 'm-auth-sesiones',
    tags: ['auth', 'seguridad'],
  },
  {
    syncId: 'm-auth-refresh',
    projectKey: 'raven-nest',
    title: 'El refresh token se rota en cada uso',
    type: 'architecture',
    topicKey: 'auth-refresh',
    gitBranch: 'feat/auth',
    originAi: 'codex',
    tags: ['auth', 'api'],
  },
  {
    syncId: 'm-rate-limit',
    projectKey: 'raven-nest',
    title: 'El rate limit del API es por cuenta, no por IP',
    type: 'architecture',
    topicKey: 'rate-limit',
    gitBranch: 'feat/api',
    originAi: 'gemini',
    tags: ['api', 'limites'],
  },
  {
    syncId: 'm-rate-limit-429',
    projectKey: 'raven-nest',
    title: 'Un 429 devuelve Retry-After en segundos',
    type: 'bugfix',
    topicKey: 'rate-limit-429',
    gitBranch: 'feat/api',
    originAi: 'gemini',
    tags: ['api', 'limites'],
  },
  {
    syncId: 'm-sqlite-wal',
    projectKey: 'otro-proyecto',
    title: 'SQLite en WAL: los -wal y -shm se mueven ANTES que el .db',
    type: 'pattern',
    topicKey: 'sqlite',
    gitBranch: 'main',
    originAi: 'claude',
    tags: ['sqlite', 'datos'],
  },
  {
    syncId: 'm-prefs-tabs',
    projectKey: 'otro-proyecto',
    title: 'Preferir tabs sobre ventanas para los worktrees',
    type: 'preference',
    topicKey: 'ui',
    gitBranch: 'main',
    originAi: null,
    tags: ['ui'],
  },
]
