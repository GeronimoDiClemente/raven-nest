// El aviso de que Cloud quedó activo. No hay servicio de toasts en la app:
// componente propio, shadcn + utilidades, por encima de cualquier overlay.
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'

export default function CloudActivadoToast({ onClose }: { onClose: () => void }) {
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[var(--z-overlay-modal)] flex items-center gap-3 rounded-lg border border-border bg-popover px-4 py-3 text-fs-sm text-popover-foreground shadow-lg"
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-ok" />
      Cloud is active — syncing all your projects.
      <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={onClose}>×</Button>
    </div>,
    document.body,
  )
}
