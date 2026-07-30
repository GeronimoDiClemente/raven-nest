// src/tutorial/tours/teams.ts
import { type TourDef } from '../types'

/**
 * Teams walkthrough. Text-only / Next-only over the live workspace. Anchors are
 * landmarks present once you're inside a team (header + switcher + left nav);
 * in the empty/create state they fall back to a centered card.
 */
export const teamsTour: TourDef = {
  id: 'teams',
  steps: [
    {
      id: 'header',
      anchor: '[data-tour-id="teams-header"]',
      title: { en: 'Teams', es: 'Teams' },
      body: {
        en: 'Share repos, chat, and track your team’s work together in real time.',
        es: 'Compartí repos, chateá y seguí el trabajo del equipo en tiempo real.',
      },
      placement: 'bottom',
    },
    {
      id: 'switcher',
      anchor: '[data-tour-id="team-switcher"]',
      title: { en: 'Your team', es: 'Tu team' },
      body: {
        en: 'Switch teams, create a new one, or join an existing team with an invite code.',
        es: 'Cambiá de team, creá uno nuevo, o unite a uno existente con un código de invitación.',
      },
      placement: 'bottom',
    },
    {
      id: 'repos',
      anchor: '[data-tour-id="teams-nav-repos"]',
      title: { en: 'Shared repos', es: 'Repos compartidos' },
      body: {
        en: 'The team’s repositories — clone them, link a folder, and open terminals.',
        es: 'Los repositorios del equipo — clonalos, linkeá una carpeta y abrí terminales.',
      },
      placement: 'right',
    },
    {
      id: 'members',
      anchor: '[data-tour-id="teams-nav-members"]',
      title: { en: 'Members', es: 'Miembros' },
      body: {
        en: 'Invite teammates, manage roles, and share the team’s join code.',
        es: 'Invitá compañeros, gestioná roles y compartí el código de ingreso del equipo.',
      },
      placement: 'right',
    },
    {
      id: 'chat',
      anchor: '[data-tour-id="teams-nav-chat"]',
      title: { en: 'Chat & activity', es: 'Chat y actividad' },
      body: {
        en: 'Team chat plus a live feed of everyone’s GitHub activity. That’s Teams!',
        es: 'Chat del equipo más un feed en vivo de la actividad de GitHub de todos. ¡Eso es Teams!',
      },
      placement: 'right',
    },
  ],
}
