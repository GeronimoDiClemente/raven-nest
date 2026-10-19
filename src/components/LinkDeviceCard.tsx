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

  // El marco de MemoryEncryptionCard y ShareProjectCard, para que el pie de Memories
  // comparta la escala del resto de la pantalla.
  const marco = 'flex shrink-0 flex-col gap-2 rounded-md border border-border p-3'

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
    <div className={marco}>
      <h4 className="m-0 text-fs font-medium text-foreground">Add a machine that has no browser</h4>
      <p className="text-fs-sm text-muted-foreground">
        For a server, a VM or an SSH box where you can't sign in with a browser. That machine
        shows you a code; you approve it here, from a machine that is already signed in.
      </p>
      <ol className="flex flex-col gap-2 text-fs-sm text-muted-foreground list-decimal pl-5">
        <li>On that machine, run <code className="font-mono">{comando('login')}</code></li>
        <li>It prints an 8-character code. Type it below within 10 minutes.</li>
      </ol>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="link-code" className="sr-only">Code</label>
        <Input
          id="link-code"
          value={tipeado}
          onChange={(e) => { setTipeado(e.target.value); setAprobado(false); setError(null) }}
          placeholder="WXYZ-1234"
          autoComplete="off"
          spellCheck={false}
          className="w-40 font-mono uppercase"
          disabled={ocupado}
        />
        <Button size="sm" onClick={() => void aprobar()} disabled={!normalizado.ok || ocupado}>
          {ocupado ? 'Approving…' : 'Approve machine'}
        </Button>
      </div>

      {avisoDeTipeo && <p className="text-fs-sm text-muted-foreground">{avisoDeTipeo}</p>}
      {error && <p className="text-fs-sm text-destructive">{error}</p>}
      {aprobado && (
        <p className="text-fs-sm text-ok">
          Approved. The other machine picks it up within a few seconds — go back to that terminal.
        </p>
      )}
    </div>
  )
}
