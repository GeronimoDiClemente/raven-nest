import { useState } from 'react'
import { Button } from '@/components/ui/button'

/**
 * El código de recuperación, una vez. Lo usan la tarjeta de Sync (al conectar) y la de
 * Encryption. «Done» queda deshabilitado hasta tildar «I have saved it somewhere safe».
 * El título («Save this code») lo pone quien lo monta: en Encryption es el nombre de la
 * fila y en Sync un párrafo, para no repetirlo.
 */
export default function RecoveryCodeBlock({ code, aviso, onDone }: { code: string; aviso?: string | null; onDone: () => void }) {
  const [guardado, setGuardado] = useState(false)
  return (
    <>
      {/* Spec §5: el aviso del código va en ESTE paso, no antes de activar. */}
      <p className="m-0 rounded-md border border-warn/40 px-2 py-1 text-fs-sm text-warn">
        Keep it somewhere safe: if you lose every machine and the code, the cloud copy can never be opened again.
      </p>
      {aviso && <p className="m-0 rounded-md border border-warn/40 px-2 py-1 text-fs-sm text-warn">{aviso}</p>}
      <p className="m-0 select-all rounded-md border border-border bg-muted/30 px-3 py-2 text-center font-mono text-fs tracking-[0.08em] text-foreground">{code}</p>
      <label className="flex items-center gap-2 text-fs-sm text-foreground">
        <input type="checkbox" checked={guardado} onChange={(e) => setGuardado(e.target.checked)} />
        I have saved it somewhere safe
      </label>
      <div><Button size="sm" disabled={!guardado} onClick={onDone}>Done</Button></div>
    </>
  )
}
