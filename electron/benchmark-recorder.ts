import os from 'os'
import pidusage from 'pidusage'

const CPU_COUNT = Math.max(1, os.cpus().length)

export interface BenchSample {
  ts: number
  cpuPct: number | null  // 0-100, normalized by CPU count
  rssMB: number | null
  mode: 'setup' | 'spotlight' | 'idle'
  processGone?: boolean
}

export interface BenchSession {
  cellId: string
  pid: number
  startedAt: number
  samples: BenchSample[]
  mode: 'setup' | 'spotlight' | 'idle'
}

const MAX_SAMPLES = 1200  // ~10 min at 500ms

async function sampleProcess(pid: number): Promise<{ cpuPct: number | null; rssMB: number | null; gone: boolean }> {
  try {
    const stat = await pidusage(pid)
    return {
      cpuPct: stat.cpu / CPU_COUNT,
      rssMB: Math.round((stat.memory / 1024 / 1024) * 10) / 10,
      gone: false,
    }
  } catch (err) {
    // pidusage throws { code: 'ESRCH' } / "No matching pid found" when the
    // process has exited — that's the legitimate "gone" signal. Anything
    // else is a real error we want surfaced so it isn't mistaken for a
    // dead process.
    const code = (err as NodeJS.ErrnoException)?.code
    const msg = err instanceof Error ? err.message : String(err)
    if (code === 'ESRCH' || /no matching pid/i.test(msg)) {
      return { cpuPct: null, rssMB: null, gone: true }
    }
    console.warn('[benchmark] pidusage failed', pid, code ?? msg)
    return { cpuPct: null, rssMB: null, gone: false }
  }
}

export class BenchmarkRecorder {
  private sessions = new Map<string, BenchSession>()
  private timers = new Map<string, NodeJS.Timeout>()

  start(cellId: string, pid: number, mode: 'setup' | 'spotlight' | 'idle'): void {
    this.stop(cellId)
    const session: BenchSession = {
      cellId,
      pid,
      startedAt: Date.now(),
      samples: [],
      mode,
    }
    this.sessions.set(cellId, session)
    const tick = async () => {
      const s = this.sessions.get(cellId)
      if (!s) return
      const sample = await sampleProcess(s.pid)
      const entry: BenchSample = {
        ts: Date.now(),
        cpuPct: sample.cpuPct,
        rssMB: sample.rssMB,
        mode: s.mode,
        processGone: sample.gone || undefined,
      }
      s.samples.push(entry)
      if (s.samples.length > MAX_SAMPLES) s.samples.splice(0, s.samples.length - MAX_SAMPLES)
    }
    void tick()
    this.timers.set(cellId, setInterval(tick, 1000))
  }

  setMode(cellId: string, mode: 'setup' | 'spotlight' | 'idle'): void {
    const s = this.sessions.get(cellId)
    if (s) s.mode = mode
  }

  get(cellId: string): BenchSession | null {
    return this.sessions.get(cellId) ?? null
  }

  list(): BenchSession[] {
    return Array.from(this.sessions.values())
  }

  stop(cellId: string): void {
    const t = this.timers.get(cellId)
    if (t) { clearInterval(t); this.timers.delete(cellId) }
    this.sessions.delete(cellId)
  }

  stopAll(): void {
    for (const id of Array.from(this.timers.keys())) this.stop(id)
  }
}
