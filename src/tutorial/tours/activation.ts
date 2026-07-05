// src/tutorial/tours/activation.ts
import { type TourDef } from '../types'

/**
 * First-run onboarding ("aha moment"). Narrated / Next-only over the live app.
 * Auto-launches once on first run; the launcher expands the sidebar so the
 * My Repos / Team items are good spotlight targets. Static for every plan: a
 * trial user (effective plan 'team' for 15 days) sees the My Repos / Team steps
 * without hitting the paywall; for a post-trial Free user those steps act as an
 * upgrade funnel. Never enters a modal and never advances on action.
 */
export const activationTour: TourDef = {
  id: 'activation',
  steps: [
    {
      id: 'welcome',
      anchor: '[data-tour-id="empty-new-terminal"]',
      title: { en: 'Welcome to Nest', es: 'Bienvenido a Nest' },
      body: {
        en: "Your multi-AI terminal workspace. You've got 15 days of Team to try everything — here's a 30-second tour.",
        es: 'Tu workspace de terminales multi-IA. Tenés 15 días de Team para probar todo — acá va un tour de 30 segundos.',
      },
      placement: 'bottom',
    },
    {
      id: 'new-terminal',
      anchor: '[data-tour-id="empty-new-terminal"]',
      title: { en: 'Open your first agent', es: 'Abrí tu primer agente' },
      body: {
        en: 'Start a real terminal running Claude, Codex, Gemini or any CLI agent. This is where the work happens.',
        es: 'Arrancá una terminal real con Claude, Codex, Gemini o cualquier agente CLI. Acá pasa todo.',
      },
      placement: 'bottom',
    },
    {
      id: 'my-repos',
      anchor: '[data-tour-id="sidebar-myrepos"]',
      title: { en: 'Your repos', es: 'Tus repos' },
      body: {
        en: 'Connect GitHub or GitLab and bring your repositories. Link a local folder to open a terminal in any of them.',
        es: 'Conectá GitHub o GitLab y traé tus repositorios. Linkeá una carpeta local para abrir una terminal en cualquiera.',
      },
      placement: 'right',
    },
    {
      id: 'team',
      anchor: '[data-tour-id="sidebar-team"]',
      title: { en: 'Work as a team', es: 'Trabajen en equipo' },
      body: {
        en: 'Invite your teammates and collaborate in the same terminals in real time.',
        es: 'Invitá a tu equipo y colaboren en las mismas terminales en tiempo real.',
      },
      placement: 'right',
    },
    {
      id: 'outro',
      anchor: '[data-tour-id="empty-new-terminal"]',
      title: { en: "You're set", es: 'Listo' },
      body: {
        en: 'Reopen any tour anytime from the "?" buttons or Settings → Tutorial. Now open a terminal and dive in.',
        es: 'Reabrí cualquier tour cuando quieras desde los botones "?" o Settings → Tutorial. Ahora abrí una terminal y a darle.',
      },
      placement: 'bottom',
    },
  ],
}
