// Este spec probaba el marketplace embebido en My Repos (Available/Installed
// grid, IntegrationPanelShell, toggle Panel/My tickets) — hito de julio 2026.
//
// Ninguno de los dos casos se puede reparar moviendo el selector a rol y
// nombre accesible, porque la constraint asume que la UI que el selector
// buscaba sigue existiendo en algún lado; acá no es así:
//
// 1. El flujo completo se retiró de la app hace más de un mes, en dos commits
//    ajenos tanto a esta migración como al rename de Personal:
//    `6977ff3` (2026-08-06) "remove integrations UI from My Repos (moved to
//    the hub)" y `cceedde` (mismo día) "remove TeamIntegrationsView from
//    Teams". IntegrationsMarketplace.tsx / IntegrationPanel/* siguen en el
//    repo (por eso el guard de la Parte 2 no los marca — TODAVÍA emiten esas
//    clases) pero ningún componente montado los importa: son código
//    huérfano. Confirmado con `grep -rln IntegrationPanelShell src --include
//    "*.tsx" | grep -v __tests__` → cero resultados fuera del propio archivo.
//    El reemplazo (ConnectionsView, dentro de IntegrationsHub) excluye a
//    propósito el fixture "demo" de mockAdapter.ts (auth.kind === 'none' →
//    "no hay nada que conectar", ver el comentario en ConnectionsView.tsx),
//    así que no hay ninguna superficie de UI real hoy para instalar/abrir
//    "Demo" ni para ejercitar el toggle Panel/My tickets de un ticket
//    provider como Jira.
// 2. Aparte de (1), el comentario "el bypass e2e resuelve a plan 'pro'" ya
//    no es cierto: sin `RAVEN_E2E_PLAN` seteado, useProfile.ts cae a plan
//    'free' (confirmado corriendo el spec con el selector de Personal ya
//    arreglado: abre el upgrade modal, no .teams-workspace).
//
// Reparar esto de verdad es escribir cobertura nueva contra
// ConnectionsView/IntegrationsHub — un tarea de alcance propio, no daño de
// la migración Tailwind/shadcn. Ver task-8c-report.md, Parte 1.
import { test } from '@playwright/test'
import { launchHarness, teardown } from './helpers/harness'

test.fixme(
  'ticket loop: vista My tickets renderiza sin crash (Jira sin creds → estado vacío)',
  async () => {
    const h = await launchHarness({ withRepo: false })
    try {
      // Ver el comentario de arriba del archivo: el toggle Panel/My tickets
      // de IntegrationPanelShell no tiene entrada de UI viva hoy.
    } finally {
      await teardown(h)
    }
  },
)

test.fixme(
  'integrations dentro de My Repos: instalar Demo → nav → panel → acciones → compose → desinstalar',
  async () => {
    const h = await launchHarness({ withRepo: false })
    try {
      // Ver el comentario de arriba del archivo: el marketplace embebido en
      // My Repos (Available/Installed, panel de Demo, compose) no tiene
      // entrada de UI viva hoy.
    } finally {
      await teardown(h)
    }
  },
)
