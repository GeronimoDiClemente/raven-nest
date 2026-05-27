// src/tutorial/tours/worktrees.ts
import type { TourDef } from '../types'

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
        en: 'Click "+" to create one from a branch.',
        es: 'Tocá "+" para crear uno a partir de una rama.',
      },
      placement: 'right',
      advanceOnClick: true,
    },
    {
      id: 'branch',
      anchor: '[data-tour-id="wt-branch-input"]',
      title: { en: 'Branch name', es: 'Nombre de la rama' },
      body: {
        en: 'Type the new branch name, e.g. feat/billing.',
        es: 'Escribí el nombre de la rama nueva, ej. feat/billing.',
      },
      placement: 'bottom',
    },
    {
      id: 'presets',
      anchor: '[data-tour-id="wt-presets"]',
      title: { en: 'Preset (optional)', es: 'Preset (opcional)' },
      body: {
        en: 'Pick a preset to run setup automatically (install deps, start the dev server).',
        es: 'Elegí un preset para correr el setup automático (instalar deps, levantar el dev).',
      },
      placement: 'bottom',
    },
    {
      id: 'env',
      anchor: '[data-tour-id="wt-env-banner"]',
      title: { en: '.env files', es: 'Archivos .env' },
      body: {
        en: 'If there are untracked .env files, you can copy them into the new worktree.',
        es: 'Si hay archivos .env sin trackear, podés copiarlos al worktree nuevo.',
      },
      placement: 'top',
    },
    {
      id: 'create',
      anchor: '[data-tour-id="wt-create-btn"]',
      title: { en: 'Create', es: 'Crear' },
      body: {
        en: 'Confirm: the worktree appears and runs its setup.',
        es: 'Confirmá: el worktree aparece y corre su setup.',
      },
      placement: 'top',
      advanceOnClick: true,
    },
    {
      id: 'list',
      anchor: '[data-tour-id="wt-list"]',
      title: { en: 'Your worktrees', es: 'Tus worktrees' },
      body: {
        en: 'They all show up here with their status (yellow = setup, green = ready).',
        es: 'Acá aparecen todos con su estado (amarillo = setup, verde = listo).',
      },
      placement: 'right',
    },
    {
      id: 'diff',
      anchor: '[data-tour-id="wt-diff-chip"]',
      title: { en: 'Changes', es: 'Cambios' },
      body: {
        en: 'The chip shows +added/−removed lines. Click it to see the full diff.',
        es: 'El chip muestra +líneas/−líneas. Tocalo para ver el diff completo.',
      },
      placement: 'right',
      advanceOnClick: true,
    },
    {
      id: 'diff-panel',
      anchor: '[data-tour-id="diff-panel"]',
      title: { en: 'Diff', es: 'Diff' },
      body: {
        en: 'Review changes file by file without leaving Nest.',
        es: 'Revisás los cambios archivo por archivo sin salir de Nest.',
      },
      placement: 'left',
    },
    {
      id: 'drag-terminal',
      anchor: '[data-tour-id="wt-list"]',
      title: { en: 'Open a terminal in a worktree', es: 'Abrí una terminal en un worktree' },
      body: {
        en: "Drag a worktree from the list into the workspace to open a terminal that runs in that worktree's folder.",
        es: 'Arrastrá un worktree de la lista al workspace para abrir una terminal que corre en la carpeta de ese worktree.',
      },
      placement: 'right',
      advanceOnAction: 'drop',
    },
    {
      id: 'sync-cwd',
      anchor: '[data-tour-id="pane-sync-cwd-btn"]',
      title: { en: "Switch a terminal's folder", es: 'Cambiá la carpeta de una terminal' },
      body: {
        en: 'Click another worktree to point this terminal at it, then hit "Sync cwd" to restart it there.',
        es: 'Tocá otro worktree para apuntar esta terminal ahí, después dale "Sync cwd" para reiniciarla en esa carpeta.',
      },
      placement: 'left',
      advanceOnAction: 'sync',
    },
    {
      id: 'pr',
      anchor: '[data-tour-id="wt-pr-chip"]',
      title: { en: 'Pull request', es: 'Pull request' },
      body: {
        en: 'If the branch has a PR, the chip takes you there. From the menu you can also "Push to GitHub".',
        es: 'Si la rama tiene PR, el chip te lleva ahí. Desde el menú también podés "Push to GitHub".',
      },
      placement: 'right',
    },
    {
      id: 'menu',
      anchor: '[data-tour-id="wt-context-menu"]',
      title: { en: 'Actions', es: 'Acciones' },
      body: {
        en: "Right-click a worktree: push, open in IDE, spotlight, or remove it. That's Worktrees!",
        es: 'Click derecho en un worktree: push, abrir en IDE, spotlight, o eliminarlo. ¡Eso es Worktrees!',
      },
      placement: 'right',
    },
  ],
}
