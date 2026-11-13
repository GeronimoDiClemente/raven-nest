// La confianza en los presets de un repo, guardada FUERA del repo.
//
// Un preset vive en `.raven/presets/*.json` adentro del repo, así que puede venir de cualquiera
// que pueda commitear: un repo clonado de un tercero, la rama de un PR. Sus `setup`/`postCreate`
// corren con `/bin/sh -c` como el usuario. Antes de correrlo la primera vez —y cada vez que
// cambia lo que ejecuta— el usuario tiene que ver los comandos y aprobarlos.
//
// La aprobación se ata a un hash de lo que se EJECUTA (comandos, env y dev), no del archivo
// entero: cambiar el nombre o la descripción no vuelve a pedirla; cambiar un comando, sí. Y
// vive en `~/.raven-nest/preset-trust.json`: si viviera en el repo, el mismo que escribe el
// preset podría escribir su aprobación.
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import type { RavenPreset } from '../src/types'

type Aprobaciones = Record<string, Record<string, string>>

/** Lo que se ejecuta, en un orden fijo: el hash no depende del orden de las claves del JSON. */
export function hashDePreset(p: RavenPreset): string {
  const env = Object.entries(p.env ?? {}).sort(([a], [b]) => a.localeCompare(b))
  const ejecutable = { postCreate: p.postCreate ?? [], setup: p.setup ?? [], dev: p.dev ?? null, env }
  return createHash('sha256').update(JSON.stringify(ejecutable)).digest('hex')
}

/** ¿Hay algo que se ejecute? Un preset de puertos y nada más no necesita aprobación. */
export function ejecutaAlgo(p: RavenPreset): boolean {
  return (p.postCreate?.length ?? 0) > 0 || (p.setup?.length ?? 0) > 0 || !!p.dev
}

export class PresetTrust {
  private readonly archivo: string

  constructor(ravenHome: string) {
    this.archivo = join(ravenHome, 'preset-trust.json')
  }

  private leer(): Aprobaciones {
    if (!existsSync(this.archivo)) return {}
    try {
      const v = JSON.parse(readFileSync(this.archivo, 'utf8')) as unknown
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Aprobaciones) : {}
    } catch {
      return {} // un archivo roto no aprueba nada
    }
  }

  private escribir(a: Aprobaciones): void {
    mkdirSync(dirname(this.archivo), { recursive: true })
    const tmp = `${this.archivo}.tmp`
    writeFileSync(tmp, JSON.stringify(a, null, 2), { mode: 0o600 })
    renameSync(tmp, this.archivo)
  }

  /** Aprobado si no ejecuta nada, o si el hash aprobado para ese repo es el de ahora. */
  estaAprobado(repoPath: string, p: RavenPreset): boolean {
    if (!ejecutaAlgo(p)) return true
    return this.leer()[resolve(repoPath)]?.[p.id] === hashDePreset(p)
  }

  aprobar(repoPath: string, p: RavenPreset): void {
    const a = this.leer()
    const repo = resolve(repoPath)
    a[repo] = { ...(a[repo] ?? {}), [p.id]: hashDePreset(p) }
    this.escribir(a)
  }
}
