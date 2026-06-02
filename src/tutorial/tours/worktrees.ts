// src/tutorial/tours/worktrees.ts
import { type TourDef } from '../types'

/**
 * Worktrees walkthrough. Text-only / Next-only: it spotlights anchors that are
 * present in the live worktrees list view (a repo must be open) and never
 * advances on click or action, so touring never triggers a real action on the
 * user's repos. Steps that lived inside the New-worktree modal or required an
 * interaction (drag a worktree, sync a terminal) were dropped on purpose.
 */
export const worktreesTour: TourDef = {
  id: 'worktrees',
  steps: [
    {
      id: 'header',
      anchor: '[data-tour-id="wt-header"]',
      title: { en: 'Worktrees', es: 'Worktrees' },
      body: {
        en: 'A worktree is a branch in its own folder: work in parallel without touching your main branch.',
        es: 'Un worktree es una rama en su propia carpeta: trabajás en paralelo sin tocar tu rama principal.',
      },
      placement: 'right',
    },
    {
      id: 'add',
      anchor: '[data-tour-id="wt-add"]',
      title: { en: 'Create a worktree', es: 'Creá un worktree' },
      body: {
        en: 'Click "+" to open the dialog: pick a branch, an optional setup preset, optionally copy your .env files, and create it.',
        es: 'Tocá "+" para abrir el diálogo: elegís una rama, un preset de setup opcional, podés copiar tus .env, y lo creás.',
      },
      placement: 'right',
    },
    {
      id: 'list',
      anchor: '[data-tour-id="wt-list"]',
      title: { en: 'Your worktrees', es: 'Tus worktrees' },
      body: {
        en: 'They all show up here with their status (yellow = setting up, green = ready). Drag one into the workspace to open a terminal in its folder.',
        es: 'Acá aparecen todos con su estado (amarillo = setup, verde = listo). Arrastrá uno al workspace para abrir una terminal en su carpeta.',
      },
      placement: 'right',
    },
    {
      id: 'diff',
      anchor: '[data-tour-id="wt-diff-chip"]',
      title: { en: 'Changes', es: 'Cambios' },
      body: {
        en: 'The chip shows +added/−removed lines. Click it to review the full diff file by file without leaving Nest.',
        es: 'El chip muestra +líneas/−líneas. Tocalo para revisar el diff completo archivo por archivo sin salir de Nest.',
      },
      placement: 'right',
    },
    {
      id: 'pr',
      anchor: '[data-tour-id="wt-pr-chip"]',
      title: { en: 'Pull request', es: 'Pull request' },
      body: {
        en: 'If the branch has a PR, the chip takes you there. You can also "Push to GitHub" from the worktree menu.',
        es: 'Si la rama tiene PR, el chip te lleva ahí. También podés "Push to GitHub" desde el menú del worktree.',
      },
      placement: 'right',
    },
    {
      id: 'menu',
      anchor: '[data-tour-id="wt-context-menu"]',
      title: { en: 'Actions', es: 'Acciones' },
      body: {
        en: "Right-click a worktree for its actions: push, open in your IDE, spotlight, or remove it. That's Worktrees!",
        es: 'Click derecho en un worktree para sus acciones: push, abrir en tu IDE, spotlight, o eliminarlo. ¡Eso es Worktrees!',
      },
      placement: 'right',
    },
  ],
}
