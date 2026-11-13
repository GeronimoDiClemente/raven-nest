import { describe, it, expect } from 'vitest'
import { resolveCommand, connectionEnv, pgDump } from '../src/pg-dump'

describe('resolveCommand', () => {
  it('cae al binario pelado cuando la variable no está', () => {
    expect(resolveCommand('PG_DUMP_CMD', 'pg_dump', {} as NodeJS.ProcessEnv)).toEqual(['pg_dump'])
  })

  // Es lo que permite correr los tests en Windows, donde no hay cliente de Postgres y el
  // binario vive adentro del contenedor de la base.
  it('parte la variable en palabras para poder envolver el binario', () => {
    const env = { PG_DUMP_CMD: 'docker exec -i nest-memory-pg pg_dump' } as NodeJS.ProcessEnv
    expect(resolveCommand('PG_DUMP_CMD', 'pg_dump', env)).toEqual(
      ['docker', 'exec', '-i', 'nest-memory-pg', 'pg_dump']
    )
  })

  it('ignora una variable vacía o de puro espacio', () => {
    expect(resolveCommand('PG_DUMP_CMD', 'pg_dump', { PG_DUMP_CMD: '   ' } as NodeJS.ProcessEnv))
      .toEqual(['pg_dump'])
  })
})

describe('connectionEnv', () => {
  // `argv` lo lee cualquier proceso de la máquina. La contraseña sale de ahí y va al ambiente
  // del hijo, que es privado del proceso.
  it('saca la contraseña de los argumentos y la manda por PGPASSWORD', () => {
    const { args, env } = connectionEnv('postgres://usuario:secreta@db.interno:5432/nest_memory')
    expect(env.PGPASSWORD).toBe('secreta')
    expect(args.join(' ')).not.toContain('secreta')
    expect(args.join(' ')).toContain('db.interno')
    expect(args.join(' ')).toContain('nest_memory')
  })

  it('desescapa una contraseña con caracteres codificados', () => {
    const { env } = connectionEnv('postgres://u:a%40b%2Fc@h:5432/d')
    expect(env.PGPASSWORD).toBe('a@b/c')
  })
})

describe('pgDump', () => {
  // El caso que importa: si el binario no está o la base rechaza, tiene que TIRAR con el
  // stderr adentro. Un dump vacío tratado como éxito es un backup que no existe.
  it('rechaza cuando el comando no existe', async () => {
    await expect(
      pgDump('postgres://u:p@127.0.0.1:1/x', {
        env: { PG_DUMP_CMD: 'este-binario-no-existe-nunca' } as NodeJS.ProcessEnv,
      })
    ).rejects.toThrow(/este-binario-no-existe-nunca|ENOENT/i)
  })
})
