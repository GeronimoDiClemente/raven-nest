// La logica de "en que estado esta el cifrado" separada de main.ts, que no se puede
// importar en un test. Pura: entra lo que main.ts sabe, sale lo que la UI muestra.

export interface EncryptionStatusInput {
  safeStorageAvailable: boolean
  connected: boolean
  keyEpoch: number
  hasMaster: boolean
  devices: Array<{ deviceId: string; name: string; publicKey: string; hasWrap: boolean }>
  undecryptable: number
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
}

export function buildEncryptionStatus(input: EncryptionStatusInput): EncryptionStatus {
  // Sin safeStorage no se guarda una maestra en disco (§6.2), y sin cuenta conectada no hay
  // nube que proteger: en los dos casos la tarjeta se muestra deshabilitada con su motivo,
  // no escondida — esconderla haria parecer que el cifrado no existe.
  const available = input.safeStorageAvailable && input.connected
  return {
    available,
    active: available && input.keyEpoch > 0 && input.hasMaster,
    keyEpoch: input.keyEpoch,
    pendingDevices: input.devices.filter((d) => !d.hasWrap).map((d) => ({ deviceId: d.deviceId, name: d.name })),
    undecryptable: input.undecryptable,
  }
}
