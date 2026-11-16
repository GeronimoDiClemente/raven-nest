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
      title: { en: 'Chat', es: 'Chat' },
      body: {
        en: 'Talk to your team without leaving the terminal.',
        es: 'Hablá con tu equipo sin salir de la terminal.',
      },
      placement: 'right',
    },
    // The team's repos live in Personal now (pick the team in the scope
    // selector), so this last step points at what is still here instead.
    {
      id: 'snippets',
      anchor: '[data-tour-id="teams-nav-snippets"]',
      title: { en: 'Shared snippets', es: 'Snippets compartidos' },
      body: {
        en: 'Snippets, workspaces and MCP configs the whole team can reuse. That’s Teams!',
        es: 'Snippets, workspaces y configs de MCP que todo el equipo reutiliza. ¡Eso es Teams!',
      },
      placement: 'right',
    },
  ],
}
