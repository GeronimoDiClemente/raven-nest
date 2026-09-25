// La logica de "en que estado esta el cifrado" separada de main.ts, que no se puede
// importar en un test. Pura: entra lo que main.ts sabe, sale lo que la UI muestra.

export interface EncryptionStatusInput {
  safeStorageAvailable: boolean
  connected: boolean
  keyEpoch: number
  hasMaster: boolean
  /** La época de la maestra que tiene ESTA máquina (`keys.bin`). `0` = ninguna. */
  masterEpoch: number
  devices: Array<{ deviceId: string; name: string; publicKey: string; hasWrap: boolean }>
  undecryptable: number
  /** Si `fetchKeyState` respondió. Ver `estadoRemotoLeido` en el objeto de salida. */
  estadoRemotoLeido?: boolean
  huellaPropia?: string | null
  huellasPorDevice?: Record<string, string>
  huellaDeLaClave?: string | null
}

export interface EncryptionStatus {
  /** Se puede activar en esta maquina. */
  available: boolean
  /** Esta activo Y esta maquina puede leer. */
  active: boolean
  keyEpoch: number
  /** Maquinas de la cuenta que publicaron su clave publica y esperan una envoltura. */
  pendingDevices: Array<{ deviceId: string; name: string }>
  undecryptable: number
  /** Si el estado del servidor se pudo leer en esta consulta. */
  estadoRemotoLeido: boolean
  /** Huella de la clave pública de ESTA máquina, para que la otra la compare. */
  huellaPropia: string | null
  /** Huella de cada máquina que espera autorización, por `deviceId`. */
  huellasPorDevice: Record<string, string>
  /** Marca de la maestra de esta máquina. Dos máquinas de la misma cuenta la comparten. */
  huellaDeLaClave: string | null
}

export function buildEncryptionStatus(input: EncryptionStatusInput): EncryptionStatus {
  // Sin safeStorage no se guarda una maestra en disco (§6.2), y sin cuenta conectada no hay
  // nube que proteger: en los dos casos la tarjeta se muestra deshabilitada con su motivo,
  // no escondida — esconderla haria parecer que el cifrado no existe.
  const available = input.safeStorageAvailable && input.connected
  return {
    available,
    // Una maestra de una época anterior no abre lo que se sube después de rotar, y el push de
    // esa máquina está cerrado con `needs_key`: la tarjeta tiene que ofrecer conseguir la
    // clave, no decir que el cifrado está activo.
    active: available && input.keyEpoch > 0 && input.hasMaster && input.masterEpoch >= input.keyEpoch,
    keyEpoch: input.keyEpoch,
    pendingDevices: input.devices.filter((d) => !d.hasWrap).map((d) => ({ deviceId: d.deviceId, name: d.name })),
    undecryptable: input.undecryptable,
    /**
     * Si el estado del servidor se pudo leer. `false` = no sabemos si la cuenta tiene clave,
     * y ahí la tarjeta NO puede ofrecer "Activar": un corte de red deja `keyEpoch = 0`, que
     * es indistinguible de "esta cuenta no tiene cifrado", y activar desde una máquina sin
     * clave rota la época y borra las envolturas de todas las demás.
     *
     * `?? true` para no romper a quien ya construía este objeto sin el campo.
     */
    estadoRemotoLeido: input.estadoRemotoLeido ?? true,
    huellaPropia: input.huellaPropia ?? null,
    huellasPorDevice: input.huellasPorDevice ?? {},
    huellaDeLaClave: input.huellaDeLaClave ?? null,
  }
}
