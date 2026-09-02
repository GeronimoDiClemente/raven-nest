/**
 * Envuelve el cuerpo de una respuesta exitosa en el sobre que exige el contrato.
 *
 * El `ProductClient` del back-office descarta **toda** respuesta cuyo cuerpo no
 * traiga `ok: true`, aunque el status sea 200 y los datos estén completos
 * (`src/core/products/client.ts`: `if (!res.ok || !cuerpo || cuerpo.ok !== true)`).
 * AiraMed lo cumple porque responde a través de su helper `apiOk`; Nest tenía un
 * `json()` propio que devolvía el objeto pelado, así que cada lectura llegaba al
 * admin como el error `"Error 200"` — un fallo sobre una respuesta correcta.
 *
 * El smoke con `curl` no podía verlo: muestra el JSON, no valida el sobre.
 *
 * Los errores NO se envuelven. El cliente ya los distingue por el status y lee
 * su campo `error`; agregarles `ok: false` sería ruido, y agregarles `ok: true`
 * convertiría un rechazo en un éxito.
 */
export function sobre(body: unknown, status: number): unknown {
  if (status >= 400) return body
  // Un cuerpo que no es un objeto plano no tiene dónde alojar el campo. Hoy no
  // pasa —todas las respuestas del contrato son objetos— pero devolverlo tal
  // cual es mejor que romper la serialización de algo que ya funcionaba.
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return body
  // `ok` primero: si el cuerpo trajera uno propio, gana el del cuerpo y el
  // problema se ve en la respuesta en vez de quedar tapado por el sobre.
  return { ok: true, ...(body as Record<string, unknown>) }
}
