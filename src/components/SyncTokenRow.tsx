// Advanced → Sync token: conectar con un token (`connectWithToken`) en vez de con el login.
import { useEffect, useState } from 'react'
import { useMemory } from '../hooks/useMemory'
import { useProfile } from '../hooks/useProfile'
import { planIncluyeNube } from '../lib/stripe'
import { nubeDeMemoriaDisponible } from '../lib/beta-de-memoria'
import SettingRow from './memories/settings/SettingRow'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function SyncTokenRow() {
  const memory = useMemory()
  const { plan } = useProfile()
  const nubeDisponible = nubeDeMemoriaDisponible(planIncluyeNube(plan))
  const [token, setToken] = useState('')
  // Cumplió su trabajo: main lo guarda en el almacén de credenciales, así que tenerlo en el
  // estado de React sólo lo deja en cada heap snapshot.
  useEffect(() => { if (memory.state === 'connected') setToken('') }, [memory.state])

  // `error` siempre: a ese estado se llega conectado, con cualquier plan.
  const visible = (memory.state === 'disconnected' && nubeDisponible) || memory.state === 'error'
  if (!visible) return null
  const pegado = token.trim()

  return (
    <SettingRow
      nombre="Sync token"
      descripcion="Connect with a token instead of signing in."
      control={
        <>
          <Input
            type="password"
            aria-label="Memory sync token"
            placeholder="Paste a sync token"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="w-48"
          />
          <Button size="sm" disabled={!pegado} onClick={() => void memory.connectWithToken(pegado)}>Connect</Button>
        </>
      }
    />
  )
}
