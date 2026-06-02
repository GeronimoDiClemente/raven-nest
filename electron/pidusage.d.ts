// El paquete `pidusage` no publica tipos propios. Declaración mínima y precisa:
// un pid devuelve un Stat; un array de pids devuelve un mapa por pid.
declare module 'pidusage' {
  export interface Stat {
    cpu: number
    memory: number
    ppid: number
    pid: number
    ctime: number
    elapsed: number
    timestamp: number
  }
  function pidusage(pids: number): Promise<Stat>
  function pidusage(pids: number[]): Promise<Record<number, Stat>>
  export default pidusage
}
