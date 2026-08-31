import type { PaneNode } from '../types'
import { paneOverlayLabel } from '../lib/pane-overlay-label'
import { FileIcon, extClass } from './ExplorerPanel'

interface Props {
  pane: PaneNode
  // Foto (dataURL) del contenido del pane, capturada al iniciar el drag. Es
  // async: null hasta que llega. Mientras tanto mostramos un label descriptivo.
  snapshot: string | null
}

// Contenido del fantasma del drag (dnd-kit DragOverlay), compartido por el
// workspace normal y el Hub. Muestra la FOTO del contenido cuando ya se
// capturó; mientras tanto, un header con el archivo (editor) / dominio
// (browser) / tipo del pane — nunca un recuadro vacío.
export function PaneDragGhost({ pane, snapshot }: Props) {
  return (
    <div className="drag-overlay-pane" style={{ '--pane-color': pane.borderColor } as React.CSSProperties}>
      {snapshot ? (
        // La foto ya incluye la barra del pane (captura del rect completo);
        // mostrarla sola evita el header duplicado.
        <img className="drag-overlay-snapshot" src={snapshot} alt="" draggable={false} />
      ) : (
        <div className="pane-header" style={{ borderBottom: `1px solid ${pane.borderColor}44` }}>
          {(() => {
            const info = paneOverlayLabel(pane)
            return info.fileName ? (
              <span className="pane-ai-label" style={{ paddingLeft: 10, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <FileIcon name={info.fileName} />
                <span className={extClass(info.fileName)}>{info.text}</span>
              </span>
            ) : (
              <span className="pane-ai-label" style={{ color: info.color, paddingLeft: 10 }}>
                {info.text}
              </span>
            )
          })()}
          <span className="pane-account-name" style={{ paddingLeft: 6 }}>{pane.accountName}</span>
        </div>
      )}
    </div>
  )
}
