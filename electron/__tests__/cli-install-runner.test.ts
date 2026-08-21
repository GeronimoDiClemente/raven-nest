import { describe, it, expect, beforeEach } from 'vitest'
import { CliInstallRunner, INSTALL_COMMANDS, installCommandFor } from '../cli-install-runner'

describe('CliInstallRunner', () => {
  let runner: CliInstallRunner

  beforeEach(() => {
    runner = new CliInstallRunner()
  })

  it('resolves done and streams output for a successful command', async () => {
    const lines: string[] = []
    const result = await runner.run('test', 'echo hello', (l) => lines.push(l))
    expect(result.state).toBe('done')
    expect(result.log).toContain('hello')
    expect(lines.some((l) => l.includes('hello'))).toBe(true)
  })

  it('non-zero exit → failed', async () => {
    const cmd = process.platform === 'win32' ? 'cmd /c exit 1' : 'sh -c "exit 1"'
    const result = await runner.run('test', cmd, () => {})
    expect(result.state).toBe('failed')
  })

  it('spawn error → failed (does not hang)', async () => {
    const result = await runner.run('test', 'definitely-not-a-real-binary-xyz', () => {})
    expect(result.state).toBe('failed')
  })

  it('redacts secret-like values in the log', async () => {
    const result = await runner.run('test', 'echo TOKEN=abc123secret', () => {})
    expect(result.log).toContain('<redacted>')
    expect(result.log).not.toContain('abc123secret')
  })

  it('rejects a second run with the same key', async () => {
    const slow = process.platform === 'win32' ? 'ping -n 3 127.0.0.1' : 'sleep 1'
    const p = runner.run('test', slow, () => {})
    await expect(runner.run('test', 'echo x', () => {})).rejects.toThrow(/already running/)
    runner.cancel('test')
    await p
  })

  it('cancel() stops mid-run with state cancelled', async () => {
    const slow = process.platform === 'win32' ? 'ping -n 30 127.0.0.1' : 'sleep 30'
    const p = runner.run('test', slow, () => {})
    await new Promise((r) => setTimeout(r, 100))
    expect(runner.cancel('test')).toBe(true)
    const result = await p
    expect(result.state).toBe('cancelled')
  }, 10000)

  it('timeout → state failed with timed out in log', async () => {
    const slow = process.platform === 'win32' ? 'ping -n 30 127.0.0.1' : 'sleep 30'
    const result = await runner.run('test', slow, () => {}, { timeoutMs: 200 })
    expect(result.state).toBe('failed')
    expect(result.log).toContain('timed out')
  }, 10000)

  it('INSTALL_COMMANDS cubre los 10 agentes con CLI instalable', () => {
    expect(Object.keys(INSTALL_COMMANDS).sort()).toEqual(
      ['amp', 'claude', 'codex', 'copilot', 'cursor', 'deepseek', 'gemini', 'grok', 'opencode', 'qwen'],
    )
  })

  // Cursor no publica en npm: su instalador es un script y difiere por SO.
  // El runner spawnea el comando de verdad, asi que mandarle el de curl en
  // Windows seria mandarlo a fallar.
  describe('installCommandFor', () => {
    const withPlatform = (value: string, fn: () => void) => {
      const orig = Object.getOwnPropertyDescriptor(process, 'platform')!
      Object.defineProperty(process, 'platform', { value, configurable: true })
      try { fn() } finally { Object.defineProperty(process, 'platform', orig) }
    }

    it('en Windows, Cursor se instala con PowerShell', () => {
      withPlatform('win32', () => {
        expect(installCommandFor('cursor')).toContain('powershell')
        expect(installCommandFor('cursor')).not.toContain('curl')
      })
    })

    it('fuera de Windows, Cursor usa el script de curl', () => {
      withPlatform('darwin', () => {
        expect(installCommandFor('cursor')).toContain('curl')
      })
    })

    it('los que son npm son iguales en los tres SO', () => {
      for (const plat of ['win32', 'darwin', 'linux']) {
        withPlatform(plat, () => {
          expect(installCommandFor('deepseek')).toBe('npm install -g @deepseek-ai/dsh')
        })
      }
    })

    it('un aiType desconocido no devuelve comando', () => {
      expect(installCommandFor('noexiste')).toBeUndefined()
    })
  })
})
