// Ambient types for the electron/main-process ("node") TypeScript project
// (tsconfig.node.json). This project has no `vite/client` reference — that's
// wired up for the renderer only, via src/vite-env.d.ts — so `import.meta.env`
// is unknown to the compiler here even though electron-vite injects it into
// main-process code at build/dev time exactly like Vite does for the
// renderer (see electron/main.ts's `import.meta.env.MAIN_VITE_*` reads).
/// <reference types="vite/client" />

// pidusage ships no bundled types and no @types/pidusage package exists.
// Minimal ambient shape covering the two call forms this repo actually uses
// (single pid / array of pids) — see benchmark-recorder.ts and
// metrics-collector.ts.
declare module 'pidusage' {
  interface Stat {
    cpu: number
    memory: number
    ppid: number
    pid: number
    ctime: number
    elapsed: number
    timestamp: number
  }
  function pidusage(pid: number): Promise<Stat>
  function pidusage(pids: number[]): Promise<Record<number, Stat>>
  export default pidusage
}
