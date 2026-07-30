// src/tutorial/tours/my-repos.ts
import { type TourDef } from '../types'

/**
 * My Repos walkthrough. Text-only / Next-only over the live panel. Anchors are
 * landmarks that are present when the panel is on its Repos tab with a connected
 * account; steps elsewhere fall back to a centered card.
 */
export const myReposTour: TourDef = {
  id: 'my-repos',
  steps: [
    {
      id: 'header',
      anchor: '[data-tour-id="myrepos-header"]',
      title: { en: 'My Repos', es: 'Mis repos' },
      body: {
        en: 'All your GitHub and GitLab repositories in one place — link a local folder to open a terminal in any of them.',
        es: 'Todos tus repos de GitHub y GitLab en un lugar — linkeá una carpeta local para abrir una terminal en cualquiera.',
      },
      placement: 'bottom',
    },
    {
      id: 'add',
      anchor: '[data-tour-id="myrepos-add"]',
      title: { en: 'Add a repo', es: 'Agregar un repo' },
      body: {
        en: 'Pick a repository from your connected accounts to start tracking it here.',
        es: 'Elegí un repositorio de tus cuentas conectadas para empezar a trackearlo acá.',
      },
      placement: 'left',
    },
    {
      id: 'nav',
      anchor: '[data-tour-id="myrepos-nav"]',
      title: { en: 'Sections', es: 'Secciones' },
      body: {
        en: 'Switch between Activity, Repos, Issues and your daily Standup.',
        es: 'Cambiá entre Activity, Repos, Issues y tu Standup diario.',
      },
      placement: 'right',
    },
    {
      id: 'list',
      anchor: '[data-tour-id="myrepos-list"]',
      title: { en: 'Your repositories', es: 'Tus repositorios' },
      body: {
        en: 'Each repo shows its local folder, CI status, and quick actions.',
        es: 'Cada repo muestra su carpeta local, el estado de CI y acciones rápidas.',
      },
      placement: 'right',
    },
    {
      id: 'actions',
      anchor: '[data-tour-id="myrepos-actions"]',
      title: { en: 'Repo actions', es: 'Acciones del repo' },
      body: {
        en: 'Open a terminal, clone or link a folder, view pull requests, or more from the menu.',
        es: 'Abrí una terminal, cloná o linkeá una carpeta, mirá los pull requests, o más desde el menú.',
      },
      placement: 'left',
    },
  ],
}
