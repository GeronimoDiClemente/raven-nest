// Smoke IN-APP del graph eval-loop — el último tramo que ningún otro test toca.
//
// Lo que ya está cubierto en otro lado: el orquestador puro (planTick y compañía,
// unit), y el launch headless contra la pty real (`graph-pty-launch.live.test.ts`).
// Lo que solo se puede ver acá, con la app corriendo de verdad:
//   · graphOrchestratorTick cada 3 s encadenando nodos sin que nadie lo empuje
//   · el worktree creado por graph:run:start
//   · el dedupe de señales entre ticks y la persistencia del run
//   · el board renderizando estado que cambia solo
//   · las decisiones humanas de punta a punta: botón → preload → IPC →
//     pendingDecision → el tick lo aplica y el run avanza (blocker C)
//
// Gateado con GRAPH_APP_SMOKE=1: corre agentes `claude` de verdad (gasta tokens,
// tarda minutos y necesita la CLI autenticada). Correr:
//   npm run pre-e2e && GRAPH_APP_SMOKE=1 npx playwright test e2e/02-graph-in-app.spec.ts
import { test } from '@playwright/test'
import { launchHarness, teardown, expect } from './helpers/harness'

const RUN = process.env.GRAPH_APP_SMOKE === '1'
const SHOTS = process.env.SMOKE_SHOTS || '/tmp/graph-app-smoke'

test.skip(!RUN, 'gateado: GRAPH_APP_SMOKE=1 (agentes reales)')

test('review-only en modo gate: el tick corre los reviewers, el gate frena, aprobar lo destraba', async () => {
  // Dos reviewers claude reales en paralelo (~45 s cada uno) más el worktree.
  test.setTimeout(420_000)

  // keepRealHome: los reviewers son `claude` de verdad y necesitan sus
  // credenciales. El storage sigue aislado por RAVEN_HOME.
  const h = await launchHarness({ keepRealHome: true })
  const { page } = h
  try {
    // El picker de carpeta es un diálogo nativo: Playwright no lo puede clickear,
    // así que lo respondemos desde el proceso main.
    await h.app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
    }, h.repoDir)

    // 1. Linkear el repo a la tab activa — sin esto handleStart se niega a arrancar.
    await page.locator('.sidebar-repo').click()
    await expect(page.locator('.sidebar-repo')).toHaveAttribute('title', h.repoDir, { timeout: 10_000 })

    // 2. Abrir el board de orquestación.
    await page.locator('.sidebar-item[title="Orchestration"]').click()
    await expect(page.locator('.gb-view')).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/01-board-vacio.png` })

    // 3. Arrancar un run de `review-only`: rev-1 y rev-2 en paralelo → gate.
    //    Es el único built-in que no usa codex.
    await page.locator('.gb-start .auto-select').selectOption({ label: 'Review only' })
    await page.locator('.gb-start .auto-input').fill('graph/app-smoke')
    await page.getByRole('button', { name: 'New run' }).click()

    // handleStart selecciona el run recién creado → caemos en el detalle.
    await expect(page.locator('.gb-detail')).toBeVisible({ timeout: 30_000 })
    await page.screenshot({ path: `${SHOTS}/02-run-arrancado.png` })

    // 4. Forzar modo `gate` con el control nuevo (blocker C). En `auto` el gate
    //    pasaría solo si los reviewers no bloquean, y no veríamos la decisión.
    const gateMode = page.locator('.gb-mode', { hasText: 'gate' })
    await gateMode.click()
    await expect(gateMode).toHaveAttribute('aria-pressed', 'true')

    // 5. Esperar a que el tick corra los dos reviewers y el gate quede esperando.
    //    Nadie empuja esto: es graphOrchestratorTick solo, cada 3 s.
    //
    //    NO se afirma en qué estado terminan los reviewers. Son LLMs de verdad
    //    sobre un repo vacío: pueden cerrar limpios ('done') o reportar un
    //    concern bloqueante, y entonces el verdict pass los deja en 'blocked'.
    //    Las dos son corridas válidas y el botón aparece igual — el gate solo
    //    necesita que sus upstream hayan RESUELTO. Afirmar `done === 2` era
    //    hardcodear lo que decide un modelo, y hacía fallar la corrida sana.
    const approve = page.getByRole('button', { name: 'Approve anyway' })
    await expect(approve).toBeVisible({ timeout: 360_000 })
    await expect(approve).toBeEnabled()
    await page.screenshot({ path: `${SHOTS}/03-gate-frenado.png` })

    // 6. La barra dice por qué frena: o lista los concerns que bloquearon, o
    //    avisa que nadie bloqueó y el gate retiene por modo. Una de las dos.
    await expect(
      page.locator('.gb-concern-from').first().or(page.locator('.gb-hint', { hasText: 'no blocking concerns' })),
    ).toBeVisible()

    // 7. Aprobar: encola el pendingDecision. Los botones se apagan hasta que el
    //    tick lo aplique — esa es la señal de que el IPC llegó a main.
    await approve.click()
    await expect(page.locator('.gb-hint', { hasText: 'applies on the next tick' })).toBeVisible({ timeout: 10_000 })

    // 8. El tick aplica la decisión y el run termina: graph:runs:list deja de
    //    devolverlo (graphRunStore.delete en `completed`), así que el board
    //    vuelve al estado vacío.
    await expect(page.locator('.gb-empty-title')).toBeVisible({ timeout: 60_000 })
    await page.screenshot({ path: `${SHOTS}/04-run-completado.png` })
  } finally {
    await teardown(h)
  }
})
