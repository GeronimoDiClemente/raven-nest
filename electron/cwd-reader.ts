import { execFile } from 'child_process'
import { promisify } from 'util'
import { readlink } from 'fs/promises'

const execFileP = promisify(execFile)

const IS_WIN = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'
const IS_LINUX = process.platform === 'linux'

export interface ProcessInfo {
  cwd: string | null
  ppid: number | null
}

// Lazy koffi bindings — only loaded on Windows the first time we need cwd.
// We read the foreign process PEB → ProcessParameters → CurrentDirectory.
// PPID comes from the same NtQueryInformationProcess call (offset 40 in
// PROCESS_BASIC_INFORMATION on x64). Offsets are valid for x64 Windows 10/11.
type WinReader = (pid: number) => ProcessInfo | null
let winReader: WinReader | null | undefined

function loadWinReader(): WinReader | null {
  if (winReader !== undefined) return winReader
  try {
    const koffi = require('koffi') as typeof import('koffi')
    const ntdll = koffi.load('ntdll.dll')
    const k32 = koffi.load('kernel32.dll')
    const NtQueryInformationProcess = ntdll.func(
      'long __stdcall NtQueryInformationProcess(void*, int, _Out_ uint8_t*, uint32_t, _Out_ uint32_t*)',
    )
    const OpenProcess = k32.func(
      'void* __stdcall OpenProcess(uint32_t, int, uint32_t)',
    )
    const ReadProcessMemory = k32.func(
      'int __stdcall ReadProcessMemory(void*, size_t, _Out_ uint8_t*, size_t, _Out_ size_t*)',
    )
    const CloseHandle = k32.func('int __stdcall CloseHandle(void*)')

    const PROCESS_QUERY_INFORMATION = 0x0400
    const PROCESS_VM_READ = 0x0010

    // Procesos elevados (Docker Desktop, servicios) o de otro usuario rebotan
    // OpenProcess con ACCESS_DENIED. Sin un log el chip de puerto simplemente
    // no aparece y el usuario asume que el feature está roto. Logueamos cada
    // PID rechazado UNA sola vez por sesión para no inundar la consola en el
    // poll de 5s.
    const accessDeniedReported = new Set<number>()
    winReader = (pid: number) => {
      const h = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid)
      if (!h || koffi.address(h) === 0n) {
        if (!accessDeniedReported.has(pid)) {
          accessDeniedReported.add(pid)
          console.warn(`[cwd-reader] cannot inspect pid ${pid} (likely elevated/other-user) — port chip will not appear for it`)
        }
        return null
      }
      try {
        const pbi = Buffer.alloc(48)
        const ret: [number] = [0]
        const status = NtQueryInformationProcess(h, 0, pbi, 48, ret)
        if (status !== 0) return null
        const pebAddr = pbi.readBigUInt64LE(8)
        const ppidRaw = pbi.readBigUInt64LE(40)
        const ppid = ppidRaw > 0n && ppidRaw < 0xffffffffn ? Number(ppidRaw) : null
        if (pebAddr === 0n) return { cwd: null, ppid }
        const paBuf = Buffer.alloc(8)
        const br: [number] = [0]
        if (!ReadProcessMemory(h, pebAddr + 0x20n, paBuf, 8, br)) return { cwd: null, ppid }
        const paAddr = paBuf.readBigUInt64LE(0)
        if (paAddr === 0n) return { cwd: null, ppid }
        const us = Buffer.alloc(16)
        if (!ReadProcessMemory(h, paAddr + 0x38n, us, 16, br)) return { cwd: null, ppid }
        const len = us.readUInt16LE(0)
        const bufPtr = us.readBigUInt64LE(8)
        if (len === 0 || bufPtr === 0n || len > 2048) return { cwd: null, ppid }
        const cwd = Buffer.alloc(len)
        if (!ReadProcessMemory(h, bufPtr, cwd, len, br)) return { cwd: null, ppid }
        return {
          cwd: cwd.toString('utf16le').replace(/\0+$/, '').replace(/\\+$/, ''),
          ppid,
        }
      } catch {
        return null
      } finally {
        try { CloseHandle(h) } catch { /* ignore */ }
      }
    }
    return winReader
  } catch (err) {
    console.warn('[cwd-reader] koffi init failed; cwd attribution disabled', err instanceof Error ? err.message : err)
    winReader = null
    return null
  }
}

export async function getProcessInfo(pid: number): Promise<ProcessInfo | null> {
  if (!Number.isFinite(pid) || pid <= 0) return null
  if (IS_WIN) {
    const reader = loadWinReader()
    if (!reader) return null
    return reader(pid)
  }
  if (IS_LINUX) {
    try {
      const cwd = await readlink(`/proc/${pid}/cwd`)
      return { cwd, ppid: null }
    } catch {
      return null
    }
  }
  if (IS_MAC) {
    try {
      const { stdout } = await execFileP('lsof', ['-a', '-d', 'cwd', '-p', String(pid), '-Fn'], { timeout: 1500 })
      const line = stdout.split('\n').find((l) => l.startsWith('n'))
      return line ? { cwd: line.slice(1), ppid: null } : null
    } catch {
      return null
    }
  }
  return null
}

// Legacy convenience wrapper — keep for any caller that only needs cwd.
export async function getCwdForPid(pid: number): Promise<string | null> {
  const info = await getProcessInfo(pid)
  return info?.cwd ?? null
}

// Returns a map of LISTENING PID → ports[] from lsof (macOS/Linux).
// Used to enumerate candidate processes for cwd-based workspace attribution.
export async function listListeningPidsPosix(): Promise<Map<number, number[]>> {
  if (IS_WIN) return new Map()
  try {
    const { stdout } = await execFileP(
      'lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn'],
      { timeout: 5000 },
    )
    const out = new Map<number, number[]>()
    let cur: number | null = null
    for (const line of stdout.split(/\r?\n/)) {
      if (line.startsWith('p')) {
        const p = parseInt(line.slice(1), 10)
        cur = Number.isFinite(p) && p > 0 ? p : null
      } else if (line.startsWith('n') && cur !== null) {
        const m = line.match(/:(\d+)$/)
        if (m) {
          const port = parseInt(m[1]!, 10)
          if (Number.isFinite(port)) {
            const arr = out.get(cur) ?? []
            if (!arr.includes(port)) arr.push(port)
            out.set(cur, arr)
          }
        }
      }
    }
    return out
  } catch (err) {
    console.warn('[cwd-reader] lsof listening scan failed', err instanceof Error ? err.message : err)
    return new Map()
  }
}

// Returns a map of LISTENING PID → ports[] from `netstat -ano` (Windows-only).
// Used to enumerate candidate processes for cwd-based workspace attribution.
export async function listListeningPidsWindows(): Promise<Map<number, number[]>> {
  if (!IS_WIN) return new Map()
  try {
    const { stdout } = await execFileP('netstat', ['-ano'], { timeout: 5000 })
    const out = new Map<number, number[]>()
    for (const line of stdout.split(/\r?\n/)) {
      const m = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/)
      if (!m) continue
      const port = parseInt(m[1]!, 10)
      const pid = parseInt(m[2]!, 10)
      if (!Number.isFinite(pid) || pid <= 0) continue
      const arr = out.get(pid) ?? []
      if (!arr.includes(port)) arr.push(port)
      out.set(pid, arr)
    }
    return out
  } catch (err) {
    console.warn('[cwd-reader] netstat failed', err instanceof Error ? err.message : err)
    return new Map()
  }
}
