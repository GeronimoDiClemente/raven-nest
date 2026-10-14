import { describe, it, expect, vi, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import type { ChildProcessWithoutNullStreams } from 'child_process'
import { WinProcessHost, END_MARKER, cpuPercentSince, cpuTimeMs, type SpawnFn } from '../win-process-host'

// Minimal stand-in for a PowerShell child: answers each "snap" line with
// whatever `respond` returns, written in arbitrary chunks like a real pipe.
function fakeChild(respond: (n: number) => string | null) {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: () => void; killed: boolean
  }
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.killed = false
  child.kill = () => { child.killed = true; setImmediate(() => child.emit('exit', 1)) }
  let n = 0
  child.stdin.on('data', (buf: Buffer) => {
    for (const line of buf.toString().split('\n')) {
      if (line !== 'snap') continue
      const out = respond(n++)
      if (out === null) continue  // simulate a hang
      // Split in two chunks to exercise line reassembly.
      const mid = Math.floor(out.length / 2)
      setImmediate(() => { child.stdout.write(out.slice(0, mid)); child.stdout.write(out.slice(mid)) })
    }
  })
  return child as unknown as ChildProcessWithoutNullStreams & { killed: boolean }
}

const rowsJson = (rows: object[]) => JSON.stringify(rows) + '\r\n' + END_MARKER + '\r\n'

describe('WinProcessHost', () => {
  afterEach(() => { vi.useRealTimers() })

  it('spawns PowerShell once and reuses it for every query', async () => {
    const spawnFn = vi.fn<SpawnFn>(() => fakeChild((n) => rowsJson([{ ProcessId: 10 + n, ParentProcessId: 1 }])))
    const host = new WinProcessHost({ spawnFn })
    const a = await host.query()
    const b = await host.query()
    const c = await host.query()
    expect(spawnFn).toHaveBeenCalledTimes(1)
    expect([a[0]!.ProcessId, b[0]!.ProcessId, c[0]!.ProcessId]).toEqual([10, 11, 12])
    host.dispose()
  })

  it('serialises concurrent queries so responses never cross', async () => {
    const host = new WinProcessHost({ spawnFn: () => fakeChild((n) => rowsJson([{ ProcessId: n }])) })
    const results = await Promise.all([host.query(), host.query(), host.query()])
    expect(results.map((r) => r[0]!.ProcessId)).toEqual([0, 1, 2])
    host.dispose()
  })

  it('treats a non-array payload as an empty table', async () => {
    const host = new WinProcessHost({ spawnFn: () => fakeChild(() => '{}\n' + END_MARKER + '\n') })
    expect(await host.query()).toEqual([])
    host.dispose()
  })

  it('rejects on invalid JSON without poisoning the next query', async () => {
    const host = new WinProcessHost({
      spawnFn: () => fakeChild((n) => (n === 0 ? 'not json\n' + END_MARKER + '\n' : rowsJson([{ ProcessId: 7 }]))),
    })
    await expect(host.query()).rejects.toThrow(/invalid JSON/)
    expect((await host.query())[0]!.ProcessId).toBe(7)
    host.dispose()
  })

  it('kills a hung PowerShell on timeout and backs off before respawning', async () => {
    let clock = 0
    const children: Array<ReturnType<typeof fakeChild>> = []
    const spawnFn = vi.fn<SpawnFn>(() => {
      const c = fakeChild(() => (children.length === 1 ? null : rowsJson([{ ProcessId: 99 }])))
      children.push(c)
      return c
    })
    const host = new WinProcessHost({ spawnFn, requestTimeoutMs: 20, now: () => clock })
    await expect(host.query()).rejects.toThrow(/timed out/)
    expect(children[0]!.killed).toBe(true)
    // Inside the back-off window: fail fast instead of spawning in a loop.
    await expect(host.query()).rejects.toThrow(/restarting/)
    expect(spawnFn).toHaveBeenCalledTimes(1)
    clock += 2_001
    expect((await host.query())[0]!.ProcessId).toBe(99)
    expect(spawnFn).toHaveBeenCalledTimes(2)
    host.dispose()
  })

  it('rejects the in-flight query when PowerShell exits', async () => {
    let child: ReturnType<typeof fakeChild> | undefined
    const host = new WinProcessHost({ spawnFn: () => (child = fakeChild(() => null)) })
    const q = host.query()
    await new Promise((r) => setImmediate(r))
    child!.emit('exit', 1)
    await expect(q).rejects.toThrow(/exited/)
    host.dispose()
  })

  it('stops answering after dispose', async () => {
    const host = new WinProcessHost({ spawnFn: () => fakeChild(() => rowsJson([])) })
    await host.query()
    host.dispose()
    await expect(host.query()).rejects.toThrow(/disposed/)
  })
})

describe('cpuPercentSince', () => {
  it('matches pidusage: CPU ms consumed over wall ms elapsed, ×100', () => {
    expect(cpuPercentSince({ ctimeMs: 1_000, at: 0 }, { ctimeMs: 1_500, at: 1_000 })).toBe(50)
    // Two cores pinned for 2 s → 200 (summed across cores, caller normalises).
    expect(cpuPercentSince({ ctimeMs: 0, at: 0 }, { ctimeMs: 4_000, at: 2_000 })).toBe(200)
  })
  it('reads 0 for a first sighting, a reused pid, or no elapsed time', () => {
    expect(cpuPercentSince(undefined, { ctimeMs: 9_999, at: 5 })).toBe(0)
    expect(cpuPercentSince({ ctimeMs: 5_000, at: 0 }, { ctimeMs: 10, at: 1_000 })).toBe(0)
    expect(cpuPercentSince({ ctimeMs: 0, at: 1_000 }, { ctimeMs: 50, at: 1_000 })).toBe(0)
  })
  it('converts 100 ns kernel+user units to milliseconds', () => {
    expect(cpuTimeMs({ KernelModeTime: 10_000_000, UserModeTime: 20_000_000 })).toBe(3_000)
    expect(cpuTimeMs({})).toBe(0)
  })
})

// Real PowerShell round trip. Only meaningful on Windows.
describe.skipIf(process.platform !== 'win32')('WinProcessHost (real PowerShell)', () => {
  it('returns the live process table, including this test process, from one PowerShell', async () => {
    const host = new WinProcessHost()
    try {
      const first = await host.query()
      const second = await host.query()
      for (const rows of [first, second]) {
        const me = rows.find((r) => r.ProcessId === process.pid)
        expect(me).toBeDefined()
        expect(me!.ParentProcessId).toBe(process.ppid)
        expect(typeof me!.WorkingSetSize).toBe('number')
        expect(typeof me!.KernelModeTime).toBe('number')
      }
      // Both answers came from the same PowerShell instance.
      const hosts = second.filter((r) => r.ParentProcessId === process.pid && /powershell/i.test(r.Name ?? ''))
      expect(hosts).toHaveLength(1)
    } finally {
      host.dispose()
    }
  }, 30_000)
})
