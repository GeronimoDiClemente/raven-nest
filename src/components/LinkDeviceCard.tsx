// Aprobar la máquina que no puede abrir un navegador.
//
// La otra punta de `@nestmux/memory login` (spec del paquete portátil §7): esa máquina muestra un
// código corto, y acá —donde sí hay una sesión iniciada— el usuario dice que es suyo. El token
// no pasa por esta pantalla: lo recibe la otra cuando lo reclama. Que nunca lo veamos es lo
// que hace que aprobar desde acá no sea una forma de conseguir credenciales para esta máquina.
//
// Self-contained como MemoryEncryptionCard y MemoryVaultCard: si el puente no expone
// `linkApprove` —un preload viejo— no se muestra nada, en vez de un botón que falla al
// tocarlo.
//
// shadcn + utilidades, sin clases nuevas en `global.css`, que es lo que manda CLAUDE.md.
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '../lib/supabase'
import { normalizarCodigo, copyDeErrorDeVinculacion } from '../lib/codigo-de-vinculacion'
import { comando } from '../lib/nombre-del-paquete'
import SettingRow from './memories/settings/SettingRow'

type PuenteDeVinculacion = {
  linkApprove?: (jwt: string, userCode: string) => Promise<{ ok: true } | { ok: false; error: string }>
}

function puente(): PuenteDeVinculacion | null {
  const api = (window as unknown as { memory?: PuenteDeVinculacion }).memory
  return api && typeof api.linkApprove === 'function' ? api : null
}

export default function LinkDeviceCard() {
  const [tipeado, setTipeado] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aprobado, setAprobado] = useState(false)

  const api = puente()
  const normalizado = useMemo(() => normalizarCodigo(tipeado), [tipeado])

  if (!api) return null

  const aprobar = async () => {
    if (!normalizado.ok) return
    setOcupado(true)
    setError(null)
    try {
      const { data } = await supabase.auth.getSession()
      const jwt = data.session?.access_token
      // Sin sesión el servicio contestaría 401, y el usuario leería "tus credenciales no
      // sirven" cuando lo que pasa es que no inició sesión. Mismo criterio que
      // `connectWithLogin` en useMemory.
      if (!jwt) {
        setError('Sign in first — approving a machine needs your login.')
        return
      }
      const r = await api.linkApprove!(jwt, normalizado.codigo)
      if (!r.ok) {
        setError(copyDeErrorDeVinculacion(r.error))
        return
      }
      setAprobado(true)
      setTipeado('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setOcupado(false)
    }
  }

  // Un código a medio tipear no es un reproche: sólo el símbolo inválido y el de más se
  // avisan mientras se escribe, porque son los dos que no se arreglan siguiendo.
  const avisoDeTipeo =
    !normalizado.ok && normalizado.motivo === 'simbolo' ? 'Codes are letters and numbers only.'
    : !normalizado.ok && normalizado.motivo === 'largo' ? 'That is longer than a code — they are 8 characters.'
    : null

  return (
    <SettingRow
      nombre="Machine without a browser"
      descripcion={<>A server, VM or SSH box. Run <code className="font-mono">{comando('login')}</code> there and approve the code it shows.</>}
      control={
        <>
          <label htmlFor="link-code" className="sr-only">Code</label>
          <Input
            id="link-code"
            value={tipeado}
            onChange={(e) => { setTipeado(e.target.value); setAprobado(false); setError(null) }}
            placeholder="WXYZ-1234"
            autoComplete="off"
            spellCheck={false}
            className="w-32 font-mono uppercase"
            disabled={ocupado}
          />
          <Button size="sm" onClick={() => void aprobar()} disabled={!normalizado.ok || ocupado}>
            {ocupado ? 'Approving…' : 'Approve'}
          </Button>
        </>
      }
    >
      {avisoDeTipeo && <p className="m-0 text-fs-sm text-muted-foreground">{avisoDeTipeo}</p>}
      {error && <p className="m-0 text-fs-sm text-destructive">{error}</p>}
      {aprobado && (
        <p className="m-0 text-fs-sm text-ok">
          Approved. The other machine picks it up within a few seconds — go back to that terminal.
        </p>
      )}
    </SettingRow>
  )
}
