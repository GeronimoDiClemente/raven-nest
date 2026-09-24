// La verificacion manual que el plan de la fase 1 dejo pendiente en dos lugares:
// Task 7 Step 4 (la escala de z-index) y Task 10 Step 4 (la fila, el overlay y la puerta
// desde Settings). Es el riesgo #1 de la spec §11: "el codigo del rediseño nunca corrio en
// la app real — solo en jsdom".
//
// Escrito como e2e y no como una pasada a ojo para que el dia que alguien mueva un z-index
// o saque la fila de la sidebar, esto grite en vez de descubrirse en produccion.
//
// LO QUE ESTE ARCHIVO **NO** CUBRE, y conviene saberlo antes de creerle:
//
// · El perfil que levanta el harness es **Free**. Hasta el 2026-09-10, en Free la fila
//   `Personal` abria el modal de upgrade en vez del workspace — ya no: el corte comercial
//   saco ese gate (lo local es gratis en todo plan) y Personal abre igual que en cualquier
//   otro plan. Este archivo sigue verificando "el overlay queda encima" contra el panel de
//   Settings en vez de Personal (mas la escala numerica del §5.4 leida del CSS real) porque
//   ya estaba escrito asi, no porque Personal siga inalcanzable en Free.
// · El lado VERDE del §2.2: una CLI que SI llega al bridge y deja su fila en `sessions`.
//   Eso si necesita un agente con credenciales. El lado rojo —el que importa, porque es el
//   unico donde el usuario pierde trabajo sin enterarse— ya no: ver el ultimo test.
//
// (Hasta el 2026-09-24 la lista decia ademas que el §2.2 entero y el overlay con un repo
// vinculado quedaban afuera. Los dos ultimos tests del archivo los cubren.)
import { test, expect } from '@playwright/test'
import { launchHarness, teardown } from './helpers/harness'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'

const SHOTS = join(__dirname, '..', 'test-results', 'memories-in-app')
mkdirSync(SHOTS, { recursive: true })

// Un harness por test, no uno compartido: `app.close()` cuelga (ver `teardown` en el
// harness), y un worker que muere en teardown reinicia el `beforeAll` del siguiente, con lo
// que los tests dejan de ver el estado que el anterior creyo dejarles.

test('la fila Memories esta debajo de Personal y encima del usuario, con su punto', async () => {
  const h = await launchHarness({ withRepo: false })
  const { page } = h
  try {
    // La app arranca con la sidebar COLAPSADA. Sin esto, este test y el de abajo probaban
    // los dos el mismo estado y la captura "expandida" mostraba la colapsada.
    // Locator por rol + nombre accesible (el title, unico nombre disponible: el
    // boton no tiene texto visible, solo el icono) en vez de la clase — sobrevive a
    // la proxima migracion de markup. El estado expandido/colapsado se lee de
    // aria-expanded, no de una clase en el contenedor.
    const toggle = page.getByRole('button', { name: /Collapse sidebar|Expand sidebar/ })
    await expect(toggle).toBeVisible({ timeout: 15_000 })
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    }

    const memories = page.getByTitle(/^Memories/).first()
    await expect(memories).toBeVisible({ timeout: 15_000 })
    // Expandida la fila muestra ademas el texto de estado al lado del nombre (§4.2).
    await expect(page.locator('.memories-status-text')).toBeVisible()

    // El orden es la mitad del pedido del §4.1 ("hermana de Personal"), asi que se mide por
    // posicion real en pantalla y no por orden en el DOM.
    // getByTitle, no getByRole: Personal es un <div> hoy (Task 7 todavia no llego al
    // pie de la sidebar) y el title es su unico nombre estable — sigue siendo valido
    // aunque la fila pase a <button> mas adelante, porque el atributo no se saca.
    const personal = page.getByTitle(/^Personal/).first()
    const settings = page.locator('.sidebar-item-settings').first()
    const yDe = async (loc: ReturnType<typeof page.locator>) => (await loc.boundingBox())!.y

    expect(await yDe(memories)).toBeGreaterThan(await yDe(personal))
    expect(await yDe(memories)).toBeLessThan(await yDe(settings))

    const dot = page.getByTestId('memories-dot').first()
    await expect(dot).toBeVisible()
    await expect(dot).toHaveAttribute('data-dot', /green|amber|red|grey/)

    await page.screenshot({ path: join(SHOTS, '01-sidebar-expandida.png') })
  } finally {
    await teardown(h)
  }
})

test('colapsada, el punto se sigue viendo — es la unica señal de estado que queda', async () => {
  const h = await launchHarness({ withRepo: false })
  const { page } = h
  try {
    // `title`, no `aria-label`: el boton no tiene texto visible (solo el icono), asi
    // que el title ES el nombre accesible. Anclarlo al rol+nombre Y al title deja el
    // test roto a proposito si alguien le saca la etiqueta accesible en vez de pasar
    // en falso.
    const toggle = page.getByRole('button', { name: /Collapse sidebar|Expand sidebar/ })
    await expect(toggle).toBeVisible({ timeout: 15_000 })
    await expect(toggle).toHaveAttribute('title', /Collapse sidebar|Expand sidebar/)

    // Arranca colapsada, pero no se asume: se fuerza el estado que este test quiere probar.
    if ((await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    // Colapsada, el nombre y el texto de estado desaparecen — el punto es lo unico que queda.
    await expect(page.locator('.memories-status-text')).toHaveCount(0)

    await expect(page.getByTestId('memories-dot').first()).toBeVisible()
    await page.screenshot({ path: join(SHOTS, '02-sidebar-colapsada.png') })
  } finally {
    await teardown(h)
  }
})

test('la escala de z-index del §5.4 es la que dice el plan, y Memories esta en el tope', async () => {
  const h = await launchHarness({ withRepo: false })
  const { page } = h
  try {
    // Task 7 Step 1: las tres custom properties, leidas del CSS que la app CARGO — no del
    // archivo fuente. Un build que no las incluya se ve aca y en ningun otro lado.
    const vars = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement)
      return {
        base: s.getPropertyValue('--z-overlay-base').trim(),
        front: s.getPropertyValue('--z-overlay-front').trim(),
        top: s.getPropertyValue('--z-overlay-top').trim(),
      }
    })
    expect(vars).toEqual({ base: '1000', front: '1100', top: '1200' })

    await page.getByTitle(/^Memories/).first().click()
    const overlay = page.locator('.memories-workspace')
    await expect(overlay).toBeVisible({ timeout: 10_000 })

    // Que use la variable del tope, no un numero suelto — la regla que la Task 7 existe
    // para imponer.
    expect(await overlay.evaluate((el) => Number(getComputedStyle(el).zIndex))).toBe(1200)
    expect(await overlay.evaluate((el) => getComputedStyle(el).position)).toBe('fixed')

    await page.screenshot({ path: join(SHOTS, '03-overlay-abierto.png') })
  } finally {
    await teardown(h)
  }
})

test('el overlay tapa de verdad lo que hay debajo, no solo por numero', async () => {
  const h = await launchHarness({ withRepo: false })
  const { page } = h
  try {
    // Settings como capa de abajo — ver la nota de arriba del archivo: ya no es el unico
    // overlay alcanzable en Free (Personal tambien lo es desde el 2026-09-10), se usa
    // porque su puerta a Memories es lo que la Task 10 dejo.
    await page.locator('.sidebar-item-settings').first().click()
    // Ya no hay pestaña "Account": Settings es una sola pagina con secciones (modelo de
    // Orca). La seccion esta montada desde que se abre el panel, asi que no hay nada que
    // clickear para llegar.

    const puerta = page.getByRole('button', { name: 'Open Memories' })
    await expect(puerta).toBeVisible({ timeout: 10_000 })
    await puerta.click()

    await expect(page.locator('.memories-workspace')).toBeVisible({ timeout: 10_000 })

    // El chequeo que un z-index alto no garantiza: lo que el navegador entrega en el centro
    // de la pantalla tiene que estar ADENTRO del overlay.
    const arriba = await page.evaluate(() =>
      Boolean(document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)?.closest('.memories-workspace'))
    )
    expect(arriba).toBe(true)

    await page.screenshot({ path: join(SHOTS, '04-overlay-sobre-settings.png') })
  } finally {
    await teardown(h)
  }
})

test('el overlay se dibuja: fila de estado arriba y un cuerpo, nunca un hueco', async () => {
  const h = await launchHarness({ withRepo: false })
  const { page } = h
  try {
    await page.getByTitle(/^Memories/).first().click()
    await expect(page.locator('.memories-workspace .memories-status-row')).toBeVisible({ timeout: 10_000 })

    // Sin repo abierto el overlay ofrece vincular uno (Task 8: la card del estado vacio,
    // por rol y nombre accesible — la clase vieja `.memories-empty` desaparecio con la
    // migracion); con repo dibuja el panel del hilo. Los dos son estados validos — lo que
    // NO puede pasar es que no haya ninguno.
    // El OR de abajo no distingue cual de los dos salio, y con `withRepo: false` siempre
    // sale el mismo: el otro lado lo cubre el ultimo test del archivo, que linkea un repo
    // y exige el panel.
    // Review M3: el locator por rol queda ANCLADO al overlay (no a `page` entero) — sin
    // esto el assert no prueba que el boton esta ADENTRO de `.memories-workspace`, solo
    // que existe en algun lado de la pagina.
    const overlay = page.locator('.memories-workspace')
    const conGrafo = await overlay.locator('.team-thread-panel').count()
    const sinRepo = await overlay.getByRole('button', { name: /link a repo/i }).count()
    expect(conGrafo + sinRepo).toBeGreaterThan(0)

    await page.screenshot({ path: join(SHOTS, '05-overlay-cuerpo.png') })

    // Y cierra: un overlay que no se puede cerrar es una trampa, no una pantalla.
    await page.locator('.memories-workspace .tw-back-btn').click()
    await expect(page.locator('.memories-workspace')).toHaveCount(0)
  } finally {
    await teardown(h)
  }
})

test('Settings ya no tiene las tarjetas de memoria — solo la puerta', async () => {
  const h = await launchHarness({ withRepo: false })
  const { page } = h
  try {
    await page.locator('.sidebar-item-settings').first().click()
    // Ya no hay pestaña "Account": Settings es una sola pagina con secciones (modelo de
    // Orca). La seccion esta montada desde que se abre el panel, asi que no hay nada que
    // clickear para llegar.
    await expect(page.getByRole('button', { name: 'Open Memories' })).toBeVisible({ timeout: 10_000 })

    // Lo que la Task 10 SACO de Settings. Si alguna vuelve, es una regresion.
    await expect(page.locator('.memory-vault-card')).toHaveCount(0)
    await expect(page.locator('.memory-hub')).toHaveCount(0)
    await expect(page.locator('.memory-status-card')).toHaveCount(0)

    await page.screenshot({ path: join(SHOTS, '06-settings-solo-la-puerta.png') })
  } finally {
    await teardown(h)
  }
})

// El hueco que el test de arriba dejaba abierto por diseño: su assert es un OR
// (`conGrafo + sinRepo > 0`), y como TODOS los tests de este archivo arrancan con
// `withRepo: false`, la rama que se ejercitaba era siempre la misma — la nota al pie.
// El lado del repo vinculado —el panel de ramas y la tarjeta de compartir, que juntos son
// tres IPC encadenados contra el main real— no lo corrió nunca nadie fuera de jsdom, donde
// esos tres IPC son mocks que devuelven lo que el test quiera.
test('con un repo vinculado se dibuja el panel de ramas, y prenderlo escribe el hilo', async () => {
  const h = await launchHarness()
  const { page } = h
  try {
    // El picker de carpeta es un diálogo nativo. `__e2e_linkRepo` es el atajo que App.tsx
    // expone bajo el mismo gate que el bypass de auth (RAVEN_E2E=1).
    await page.evaluate((dir) => {
      ;(window as unknown as { __e2e_linkRepo?: (p: string) => void }).__e2e_linkRepo?.(dir)
    }, h.repoDir)
    await expect(page.locator('.sidebar-repo-name')).toHaveText(h.repoDir.split('/').pop()!, { timeout: 10_000 })

    await page.getByTitle(/^Memories/).first().click()
    const overlay = page.locator('.memories-workspace')
    await expect(overlay).toBeVisible({ timeout: 10_000 })

    // 1. Estamos del otro lado del ternario: la nota al pie de "sin repo" no está.
    await expect(overlay.getByRole('button', { name: /link a repo/i })).toHaveCount(0)

    // 2. Y el panel de ramas sí. Que se vea ya prueba que los tres IPC encadenados de
    //    TeamThreadPanel contestaron ok contra el main de verdad
    //    (projectKeyForWorktree → getSettings → read): un fallo en cualquiera de ellos
    //    reemplaza el panel ENTERO por `.team-thread-error`. El assert del error igual se
    //    escribe, porque "no aparece el panel" y "aparece el error" son dos rojos
    //    distintos y conviene que el test diga cuál de los dos pasó.
    await expect(overlay.locator('.team-thread-panel')).toBeVisible({ timeout: 15_000 })
    await expect(overlay.locator('.team-thread-error')).toHaveCount(0)

    // El repo de e2e no tiene remote, así que el projectKey sale del PATH
    // (resolveProjectKey: remote → path → global). Es el camino que una carpeta local
    // recién abierta recorre de verdad, y el que un repo con remote nunca ejercita.

    // 3. La tarjeta de compartir tampoco se había dibujado jamás en la app: sin repo
    //    devuelve null y sale del árbol.
    await expect(overlay.getByText(/Share (this project with a team|memory with your team)/)).toBeVisible()

    await page.screenshot({ path: join(SHOTS, '07-overlay-con-repo.png') })

    // 4. El hilo arranca APAGADO, que es el default de `loadTeamThreadSettings`.
    const prender = overlay.getByRole('button', { name: 'Turn on' })
    await expect(prender).toBeVisible()

    // 5. Prenderlo no es un toggle de UI: corre `runTeamThreadForRepo` en main, que
    //    escribe `.nest/team/` en el repo. Sin plan conocido no se bloquea
    //    (`planAllowsTeamSharing(undefined) === true`), que es el caso de una máquina sin
    //    conectar — o sea, el de este harness.
    await prender.click()
    await expect(overlay.getByRole('button', { name: 'Turn off' })).toBeVisible({ timeout: 30_000 })
    // Un repo recién creado no tiene memorias, así que el grafo tiene sólo el índice y el
    // panel lo dice en vez de dibujar un punto solo en el medio.
    await expect(overlay.getByText(/No branch notes yet/)).toBeVisible()

    // Y el hilo quedó ESCRITO, que es lo que el botón promete. Sin esto el test se
    // conformaría con que el botón cambie de nombre: `setSettings` guarda el ajuste y
    // recién después corre `runTeamThreadForRepo`, así que un fallo del pase de escritura
    // se ve en el disco y en ningún otro lado.
    expect(existsSync(join(h.repoDir, '.nest', 'team', '_index.md'))).toBe(true)
    await page.screenshot({ path: join(SHOTS, '08-hilo-prendido.png') })
  } finally {
    await teardown(h)
  }
})

// §2.2, el fallo mudo: una terminal que Nest cree que tiene memoria y que nunca llego al
// bridge. Es el unico estado donde el usuario esta perdiendo trabajo sin enterarse, y por
// eso es el que tapa a todos los demas en `summarizeMemories`.
//
// El plan lo dejo pendiente como "hay que abrir `claude` de verdad, con credenciales, y
// esperar 15s". No hace falta: lo que produce el estado NO es que la CLI sea claude, es que
// `pty-manager` haya registrado el pane en `memoryPanes` (lo hace en el mismo lugar donde
// inyecta el socket) y que la tabla `sessions` no tenga su fila. Cualquier binario de nombre
// simple que se quede vivo lo consigue — `cat` sobre una pty espera stdin para siempre y no
// habla el protocolo del bridge, que es exactamente el sintoma.
//
// Lo que esto ejercita y ningun unit puede: que el registro del pane, el cruce del handler
// `memory:sessions` y el poll del hook terminen pintando el punto. `reconcileSessions` sola
// ya esta cubierta aparte, y es pura.
test('una terminal con el bridge inyectado que nunca escribe pinta la fila de rojo', async () => {
  const h = await launchHarness({ withRepo: false })
  const { page } = h
  try {
    const toggle = page.getByRole('button', { name: /Collapse sidebar|Expand sidebar/ })
    await expect(toggle).toBeVisible({ timeout: 15_000 })
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')

    const dot = page.getByTestId('memories-dot').first()
    await expect(dot).toBeVisible({ timeout: 15_000 })
    await expect(dot).not.toHaveAttribute('data-dot', 'red')

    // `accountDir` vacio a proposito: es el camino del §3.2 (un nodo headless corre con el
    // HOME real y accountDir vacio, y antes se saltaba en silencio). El bridge se inyecta
    // igual, derivando la cuenta del nombre del binario.
    const creado = await page.evaluate(() =>
      (window as unknown as { pty: { create(id: string, cmd: string, dir: string): Promise<{ ok: boolean }> } })
        .pty.create('pane-9-1700000000000', 'cat', ''))
    expect(creado.ok).toBe(true)

    // Antes de la gracia NO es rojo: un falso "mudo" en cada terminal que se abre entrenaria
    // al usuario a ignorar el indicador. Esta mitad es la que se rompe si alguien saca el
    // `now - startedAt < graceMs`.
    //
    // Se SOSTIENE en el tiempo en vez de mirarse una vez. El poll de `useMemories` tarda
    // hasta 5s en ver el pane recien creado, asi que un assert instantaneo pasa igual
    // aunque la gracia no exista — probado: con `health = 'silent'` desde el arranque, la
    // version de una sola mirada seguia en verde. 9s cae despues del poll y antes de los
    // 15s de la gracia.
    const hasta = Date.now() + 9_000
    while (Date.now() < hasta) {
      expect(await dot.getAttribute('data-dot')).not.toBe('red')
      await page.waitForTimeout(500)
    }

    // Y pasada la gracia (SESSION_GRACE_MS = 15s) si, sin que nadie refresque nada: lo
    // levanta el poll de `useMemories`.
    await expect(dot).toHaveAttribute('data-dot', 'red', { timeout: 40_000 })
    await expect(page.locator('.memories-status-text')).toHaveText('1 session not writing')

    await page.screenshot({ path: join(SHOTS, '09-fila-roja.png') })

    // Y el overlay lo explica en vez de dejar el punto rojo sin motivo: la fila de estado
    // lista la terminal por su nombre.
    await page.getByTitle(/^Memories/).first().click()
    const overlay = page.locator('.memories-workspace')
    await expect(overlay).toBeVisible({ timeout: 10_000 })
    await expect(overlay.getByText(/terminal not writing to memory/)).toBeVisible()
    await expect(overlay.getByText(/pane 9/)).toBeVisible()
    await page.screenshot({ path: join(SHOTS, '10-overlay-fila-roja.png') })
  } finally {
    await teardown(h)
  }
})
