import { enrolarEstaMaquina, type ResultadoDeEnrolamiento } from './enrolamiento-del-paquete'
import { ensureKeyMaterial, saveKeyMaterial, type KeyMaterial, type SafeStorageLike } from './memory-key-store'
import { enrollPublicKey, fetchKeyState, type KeysClientDeps } from './memory-keys-client'
import { unwrapWithDevice, huellaDeClave } from './memory-key-wrap'

export async function enrolarDesdeLogin(
  home: string,
  safe: SafeStorageLike,
  cliente: KeysClientDeps,
): Promise<ResultadoDeEnrolamiento> {
  try {
    // Se carga recién cuando el enrolamiento lo pide: sin llavero no se genera ninguna
    // clave. Guardar la maestra conserva el mismo par cuya pública acabamos de publicar.
    let material: KeyMaterial
    return await enrolarEstaMaquina({
      hayLlavero: () => safe.isEncryptionAvailable(),
      material: () => (material = ensureKeyMaterial(home, null, safe)),
      guardarMaestra: (master, keyEpoch) => saveKeyMaterial(home, null, safe, {
        ...material, master, keyEpoch,
      }),
      enrolar: (publicKey) => enrollPublicKey(cliente, publicKey),
      estadoRemoto: () => fetchKeyState(cliente),
      desenvolver: unwrapWithDevice,
      huella: huellaDeClave,
    })
  } catch (err) {
    // La credencial ya está guardada. También las fallas al abrir el llavero o preparar
    // keys.bin tienen que dejar el login exitoso, sin ocultar que el cifrado sigue pendiente.
    return { estado: 'error', detalle: err instanceof Error ? err.message : String(err) }
  }
}
