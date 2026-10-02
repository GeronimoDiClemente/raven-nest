// La línea de `npx nest-memory status` sobre la nube. Aparte de la CLI para poder probarla:
// `cli-del-paquete.ts` corre el comando apenas se importa.

/**
 * Qué decir sobre la nube en `status`. Las cuatro situaciones piden cosas distintas, y por eso
 * no se colapsan en «sincronizado / no sincronizado».
 */
export function lineaDeSync(e: { modo: 'nest' | 'propia'; enCola: number; hayCredencial: boolean; hayServicio: boolean }): string {
  const cambios = `${e.enCola} ${e.enCola === 1 ? 'change' : 'changes'}`
  // La base de Nest la sincroniza Nest: el paquete no la sube con su credencial porque
  // podría ser de otra cuenta (ver `comandoMcp`).
  if (e.modo === 'nest') {
    return e.enCola > 0 ? `${cambios} waiting for Nest to sync them.` : 'Nest syncs this memory when it runs.'
  }
  if (!e.hayCredencial) {
    return e.enCola > 0
      ? `Local only — ${cambios} queued. Run \`npx nest-memory login\` to sync them.`
      : 'Local only. Run `npx nest-memory login` to sync across machines.'
  }
  if (!e.hayServicio) return `Connected, but NEST_MEMORY_SYNC_URL is not set — ${cambios} queued.`
  return e.enCola > 0
    ? `Connected — ${cambios} waiting to sync. They go up the next time an agent saves a memory.`
    : 'Connected — everything is synced.'
}
