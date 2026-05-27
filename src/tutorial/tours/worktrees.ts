// src/tutorial/tours/worktrees.ts
import type { TourDef } from '../types'

export const worktreesTour: TourDef = {
  id: 'worktrees',
  steps: [
    { id: 'header', anchor: '[data-tour-id="wt-header"]', title: 'Worktrees', body: 'Un worktree es una rama en su propia carpeta: trabajás en paralelo sin pisar tu rama principal.', placement: 'right' },
    { id: 'add', anchor: '[data-tour-id="wt-add"]', title: 'Creá un worktree', body: 'Tocá "+" para crear uno nuevo a partir de una rama.', placement: 'right', advanceOnClick: true },
    { id: 'branch', anchor: '[data-tour-id="wt-branch-input"]', title: 'Nombre de la rama', body: 'Poné el nombre de la rama nueva, ej. feat/billing.', placement: 'bottom' },
    { id: 'presets', anchor: '[data-tour-id="wt-presets"]', title: 'Preset (opcional)', body: 'Elegí un preset para que corra setup automático (instalar deps, levantar dev).', placement: 'bottom' },
    { id: 'env', anchor: '[data-tour-id="wt-env-banner"]', title: 'Archivos .env', body: 'Si hay .env no trackeados, podés copiarlos al worktree nuevo.', placement: 'top' },
    { id: 'create', anchor: '[data-tour-id="wt-create-btn"]', title: 'Crear', body: 'Confirmá: el worktree aparece y corre su setup.', placement: 'top', advanceOnClick: true },
    { id: 'list', anchor: '[data-tour-id="wt-list"]', title: 'Tus worktrees', body: 'Acá aparecen todos, con su estado (amarillo = setup, verde = listo).', placement: 'right' },
    { id: 'diff', anchor: '[data-tour-id="wt-diff-chip"]', title: 'Cambios', body: 'El chip muestra +líneas/−líneas. Tocalo para ver el diff completo.', placement: 'right', advanceOnClick: true },
    { id: 'diff-panel', anchor: '[data-tour-id="diff-panel"]', title: 'Diff', body: 'Revisás los cambios archivo por archivo, sin salir de Nest.', placement: 'left' },
    { id: 'pr', anchor: '[data-tour-id="wt-pr-chip"]', title: 'Pull request', body: 'Si la rama tiene PR, el chip te lleva ahí. Desde el menú podés hacer "Push to GitHub".', placement: 'right' },
    { id: 'menu', anchor: '[data-tour-id="wt-context-menu"]', title: 'Acciones', body: 'Click derecho en un worktree: push, abrir en IDE, spotlight, o eliminarlo. ¡Eso es Worktrees!', placement: 'right' },
  ],
}
