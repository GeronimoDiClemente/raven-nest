// src/tutorial/tours/activation.ts
import type { TourDef } from '../types'

export const activationTour: TourDef = {
  id: 'activation',
  steps: [
    {
      id: 'new-terminal',
      anchor: '[data-tour-id="new-terminal"]',
      title: 'Creá tu primer pane',
      body: 'Cada pane es una terminal con un AI corriendo (Claude, Gemini, Codex…). Empezá creando el primero.',
      placement: 'bottom',
      advanceOnClick: true,
    },
    {
      id: 'ai-grid',
      anchor: '[data-tour-id="ai-grid"]',
      title: 'Elegí un AI',
      body: 'Seleccioná qué asistente correr en este pane. Cada uno usa su propia cuenta y color.',
      placement: 'right',
      advanceOnClick: true,
    },
    {
      id: 'account',
      anchor: '[data-tour-id="account-field"]',
      title: 'Conectá una cuenta',
      body: 'La primera vez creás una cuenta para el AI; después queda guardada y la reusás entre panes.',
      placement: 'bottom',
    },
    {
      id: 'link-repo',
      anchor: '[data-tour-id="link-repo"]',
      title: 'Linkeá un repo',
      body: 'Asociá una carpeta de proyecto al workspace para que el AI trabaje sobre tu código.',
      placement: 'right',
    },
    {
      id: 'tabs',
      anchor: '[data-tour-id="workspace-tabs"]',
      title: 'Workspaces en tabs',
      body: 'Guardá distintos layouts de panes como workspaces y cambiá entre ellos desde las tabs de arriba. ¡Listo para empezar! Después explorá My Repos, Teams y Worktrees desde la barra lateral.',
      placement: 'bottom',
    },
  ],
}
