// Integrations y Orchestration estan escondidas detras de este flag mientras no
// salen en esta release (decision del usuario, 2026-09-10). El test no verifica
// comportamiento interesante por si mismo — existe para que alguien que prenda el
// flag por error (o el flag vuelva a `true` en un merge) lo note en CI antes de
// que la fila reaparezca en produccion sin querer.
import { describe, it, expect } from 'vitest'
import { ENABLE_INTEGRATIONS_ORCHESTRATION } from '../../lib/releaseFlags'

describe('releaseFlags', () => {
  it('mantiene Integrations/Orchestration apagadas por default', () => {
    expect(ENABLE_INTEGRATIONS_ORCHESTRATION).toBe(false)
  })
})
