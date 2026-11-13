// El UpgradeModal de siempre, montado sólo abierto: así la lectura del perfil no corre en cada
// render. Lo comparten «See plans» de This project y el Upgrade de la fila de estado de
// Memories (spec 2b-1 §4.5, D9).
import { createPortal } from 'react-dom'
import UpgradeModal from './UpgradeModal'
import { useProfile } from '../hooks/useProfile'

export default function PlanesModal({ onClose }: { onClose: () => void }) {
  const { plan } = useProfile()
  return createPortal(<UpgradeModal currentPlan={plan} onClose={onClose} />, document.body)
}
