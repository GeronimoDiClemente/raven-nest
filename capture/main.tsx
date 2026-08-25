import { createRoot } from 'react-dom/client'
import '../src/styles/global.css'
import { CaptureWorktrees } from './CaptureWorktrees'

createRoot(document.getElementById('root')!).render(<CaptureWorktrees />)
