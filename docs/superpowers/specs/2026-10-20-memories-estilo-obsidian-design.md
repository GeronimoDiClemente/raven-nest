# Memories estilo Obsidian — diseño

**Fecha:** 2026-10-20 · **Rama:** `feat/memories-settings` · **Estado:** para revisión de Gero

Mockup interactivo (explorer, pestañas, grafo 2D, live preview, panel derecho):
https://claude.ai/artifact/LyWpMQ3MijSatbsFhuDPwX

Primero de cuatro subproyectos acordados el 20-10, en este orden: (1) esta vista,
(2) Memory settings y lo que cuelga de ahí, (3) idioma de Nest, (4) tema claro. Aparte, y
después de este: la vista del plugin sin Nest (TUI estilo Engram y luego un panel en la
extensión de Cursor/VS Code), que es la razón del requisito de §6.

## 1. Problema

La vista principal de Memories (spec del 19-10, §2) es un grafo 3D dentro de una caja, con
esferas grandes cuyas etiquetas se pisan, un panel de filtros al costado y una lista abajo.
Leer una memoria pasa en un panel angosto y editarla, en un `<textarea>` de Markdown crudo.
Gero quiere que la pantalla sea **Obsidian**: las dos cosas, el grafo y la experiencia de
notas, con el layout de tres zonas.

Lo que ya existe y se conserva: el Markdown con `[[links]]` navegables (resolución por
topic → último tramo → alias → título, hecha en main), los huecos, «Mentioned in», la
edición y el borrado desde la UI, conectar dos memorias a mano, el color por tipo desde la
paleta ANSI del tema de terminal, la fila de estado, Settings, la bienvenida y el tour.

## 2. Decisiones de Gero (20-10)

1. **Las dos, como Obsidian**: explorer + nota + grafo local, y un grafo global.
2. **Grafo 2D**, no 3D.
3. **Explorer por carpetas de proyecto**: Personal / un proyecto por repo / Team.
4. **El grafo global es una pestaña** del centro, la primera y fija.
5. **Panel derecho**: grafo local, backlinks y links salientes, propiedades y outline.
6. **Live preview como Obsidian**, sobre **CodeMirror 6** (opción A; se descartaron un
   WYSIWYG sobre ProseMirror, que reserializa el Markdown y generaría mutaciones
   sincronizadas fantasma, y Monaco, que no está hecho para ocultar sintaxis).

## 3. Layout y navegación

El overlay a pantalla completa y su header (Back · «Memories» · «How it works» · Settings)
no cambian. La fila de estado (`MemoriesStatusRow`) queda como franja fina bajo el header.
Debajo, tres zonas:

- **Explorer (izquierda, ~260 px).** Buscador, «+ New memory» y un árbol de carpetas:
  Personal, una por proyecto y Team, en ese orden; adentro, las memorias por fecha de
  actualización, con el punto de color del tipo y el título en una línea. El buscador
  filtra el árbol y abre las carpetas con resultados; **también resalta las coincidencias
  en la pestaña Graph** y atenúa el resto, como hoy. La carpeta abierta/cerrada se recuerda.
- **Centro con pestañas.**
  - «Graph» es la primera pestaña, fija (no se cierra), y es la que se ve al entrar.
  - Click en una memoria (árbol, nodo, `[[link]]`, backlink) la abre en una pestaña nueva
    o enfoca la que ya está abierta. Ctrl/Cmd+click la abre sin cambiar de pestaña.
  - × o Ctrl/Cmd+W cierra la pestaña activa; la activa pasa a la de la izquierda.
  - Las pestañas abiertas se recuerdan mientras la app está abierta; al reiniciar se
    vuelve a sólo Graph.
  - Si el repo activo tiene el hilo del equipo encendido, «Team thread» es una segunda
    pestaña fija al lado de Graph, con el `TeamThreadPanel` de hoy adentro (deja de estar
    apilado al pie de la pantalla).
- **Panel derecho (~300 px).** Con una memoria activa: Local graph, Mentioned in, Links to
  (con los huecos), Properties y Outline, cada una colapsable. Con Graph activa: los filtros
  y la leyenda (§4). Con Team thread activa: se oculta.
- Las dos columnas laterales se redimensionan arrastrando el borde, se colapsan y recuerdan
  su ancho (`localStorage`, con try/catch: si falla, arrancan con el ancho por defecto).
  Con la ventana angosta (< 1100 px) el panel derecho arranca colapsado.

**Escribir a mano.** «+ New memory» abre una pestaña «New memory» con el `NewMemoryForm`
de hoy adentro, con la carpeta seleccionada en el árbol ya elegida como proyecto. Al
guardar, la pestaña pasa a ser la de la memoria nueva, en live preview.

**Conectar a mano** (`window.memory.link`, hoy un botón del panel). Pasa al menú «⋯» de la
pestaña de la memoria: «Connect to another memory…» muestra la banda de hoy («Pick the
memory this one goes with — in the explorer or in the graph») y el próximo click en el
árbol o en un nodo completa el enlace en vez de abrir la memoria. Esc cancela.

**Lo que desaparece:** la lista de abajo (`MemoriesList`) y la caja del grafo
(`MemoryGraphPanel`). Los chips de tipo de la vista del 19-10 pasan a los filtros (§4).

## 4. El grafo 2D

Un componente, `MemoryGraph2D`, sobre `react-force-graph-2d`, usado en la pestaña Graph y
en el grafo local del panel. Mismos datos que hoy (nodos y aristas: revision, same topic,
same branch, similar, wikilink, y los enlaces a mano): **no cambia nada en main ni en el
IPC**.

- **Nodos:** círculos chicos con el color del tipo (paleta ANSI, `memory-type-legend.ts`);
  el radio crece poco con el grado. Los huecos, círculo sin relleno.
- **Aristas:** líneas finas grises. Los `[[links]]` y los enlaces a mano, sólidas; las
  inferidas (similar, same branch, same topic), punteadas y más tenues. «Revision» sólida.
- **Etiquetas:** aparecen a partir de un umbral de zoom; la del nodo bajo el mouse, siempre.
- **Hover:** el nodo, sus vecinos y sus aristas a pleno; el resto, atenuado.
- **Interacción:** física suave, arrastrar un nodo lo fija, pan y zoom. Click abre la
  memoria (§3). Un hueco no navega: muestra «Not written yet».
- **Pestaña Graph:** ocupa el centro. En el panel derecho: Color by (Type / Project / Tag),
  tipos con contador (filtran), proyectos, tags, «Hide unconnected», «Hide guessed links»,
  un slider de tamaño de nodo y otro de distancia de los links. Leyenda de líneas abajo.
- **Grafo local:** la memoria activa resaltada al centro, sus vecinos a 1 salto (toggle a
  2), etiquetas siempre visibles, física más lenta. Click en un vecino lo abre.
- **Escala:** canvas 2D. Arriba de ~2000 nodos se apoya en las etiquetas por zoom; no hay
  otro tope.

Sale `MemoryGraph3D.tsx`. **`Graph3D`, `Graph3DLazy`, `three` y `react-force-graph-3d` se
quedan**: los usa `TeamThreadGraph`.

## 5. La nota en live preview (CodeMirror 6)

**Qué se ve.** El título arriba, grande y editable en el lugar. Una línea chica debajo con
tipo · proyecto · rama · hace cuánto · logo del agente. El cuerpo, un editor CodeMirror 6
cuyo documento es **el Markdown tal cual**, mostrado formateado:

- Encabezados con su tamaño, negrita, itálica, código en línea, bloques de código, listas,
  citas y separadores.
- La sintaxis (`**`, `#`, `` ` ``, `[[`/`]]`) se oculta salvo en la línea (o la selección)
  donde está el cursor, que la muestra para editarla.
- `[[links]]` como links: click abre, Ctrl/Cmd+click abre en segundo plano. Se resuelven con
  la misma `links` que manda main en el detalle; uno sin resolver se ve atenuado y su click
  ofrece «Create this memory», que abre la pestaña «New memory» con ese título.
- Escribir `[[` abre un autocompletado con títulos, topics y alias.
- **Seguridad:** todo widget es DOM armado por nosotros, nunca HTML salido del contenido.
  Es la regla de `MemoryMarkdown` (una memoria la puede escribir cualquier agente o venir
  de otra máquina del equipo); el test lo fija.

**Guardado automático**, como Obsidian: 1,5 s después de dejar de escribir, al cambiar de
pestaña, al cerrarla y al cerrar el overlay. Usa `window.memory.updateFromUi` como hoy, así
que sync, cifrado y Lamport no se tocan; el debounce existe para no generar una mutación
sincronizada por tecla. Indicador «Saving…» / «Saved» al lado de la línea de metadatos.
Un título vacío no se guarda (se marca el campo, el cuerpo sí se conserva en la pestaña).

**Errores** (los `reason` que ya devuelve el store):
- `superseded`: la pestaña pasa a sólo lectura con una banda «A newer version replaced this
  one» y un botón para abrir la nueva. Lo escrito se copia al portapapeles.
- `deleted` / `not_found`: sólo lectura con «This memory was deleted».
- Cualquier otro error: banda con «Retry»; lo editado sigue en la pestaña.
- `unchanged`: nada.

**Cambio desde afuera** (`onChanged` con la memoria abierta): sin cambios locales, la
pestaña se recarga sola; con cambios locales sin guardar, la banda de `superseded`.

**Menú «⋯» de la pestaña:** Connect to another memory… (§3) y Delete (con la confirmación
de hoy). Una memoria `superseded` o borrada no ofrece ninguna de las dos.

Salen el `<textarea>` de edición y `MemoryMarkdown.tsx` (hoy sólo lo usa
`MemoryGraphPanel`; si al planear aparece otro uso, se queda para ese).

## 6. Componentes

Nuevos, en `src/components/memories/`. **Ninguno toca `window.memory` ni nada de
Electron**: todo entra por props y sale por callbacks, para poder montarlos después en el
webview de la extensión de Cursor/VS Code.

| Componente | Responsabilidad |
|---|---|
| `MemoriesExplorer` | Árbol por carpeta + buscador. `items`, `query`, `onQuery`, `onOpen(syncId, {background})`, `onNew(carpeta)`. |
| `useMemoryTabs` | Hook puro: pestañas abiertas, activa, abrir/enfocar/cerrar, fijas. |
| `MemoryTabs` | La barra de pestañas y los atajos, sobre `useMemoryTabs`. |
| `MemoryGraph2D` | El grafo (global o local): `nodes`, `edges`, `focus`, `hops`, filtros, `highlighted`, `onOpen`. |
| `GraphFiltersPanel` | Filtros y leyenda de la pestaña Graph. |
| `MemoryNoteEditor` | Título + CodeMirror 6 en live preview + guardado con debounce + bandas. `detail`, `linkTargets`, `onSave(title, content) → resultado del store`, `onOpen`. |
| `MemoryNoteSidePanel` | Local graph, Mentioned in, Links to, Properties, Outline. |

`MemoriesWorkspace` sigue siendo el shell del overlay y **la única pieza que habla con
`window.memory`**: pide grafo, lista y detalle, escucha `onChanged`, guarda, borra y conecta,
y reparte los datos.

Los pasos del tour de la vista principal que hoy apuntan a `memories-graph`,
`memories-list` y `memories-new` pasan a apuntar al explorer, a la pestaña Graph y a una
nota abierta; el texto se ajusta a la forma nueva. El tour de settings no cambia.

## 7. Datos y dependencias

- **Sin IPC nuevo**: `graph`, `crossProject`, el detalle (que trae `links`, `mentionedIn` y
  vecinos), `updateFromUi`, `deleteFromUi`, `saveFromUi`, `link`, `onChanged`.
- **A confirmar al planear**: el autocompletado de `[[` necesita topics y alias de todas
  las memorias. Si hoy no llegan al renderer, se suman al payload de la lista existente,
  no a un canal nuevo.
- **Entran:** `react-force-graph-2d`, `@codemirror/state`, `@codemirror/view`,
  `@codemirror/lang-markdown`, `@codemirror/autocomplete` (y lo que `lang-markdown` traiga
  de `@lezer`). Versiones exactas fijadas en el plan.
- **No sale ninguna dependencia** (ver §4 sobre el 3D).

## 8. Tests

- **Unitarios:**
  - `useMemoryTabs`: abrir, enfocar la ya abierta, cerrar la activa y cuál queda, Graph no
    se cierra, abrir en segundo plano.
  - Armado del árbol: orden de carpetas, agrupación, filtro por búsqueda.
  - Live preview: qué marcas se ocultan fuera de la línea del cursor y cuáles se muestran
    en ella; un contenido con `<img onerror>` o `<script>` no produce elementos.
  - Guardado: debounce, guardado al cerrar la pestaña, las bandas de `superseded`,
    `deleted`, error y el silencio de `unchanged`; título vacío no guarda.
  - Grafo: vecinos a 1 y 2 saltos, filtros por tipo, «hide guessed», resaltado por búsqueda.
  - Conectar a mano desde el menú: el próximo click enlaza en vez de abrir; Esc cancela.
- **e2e:** abrir Memories → Graph → abrir una memoria desde un nodo → editarla → ver
  «Saved» → seguir un `[[link]]` → cerrar la pestaña.
- **Lo que ya pide el repo:** `e2e/04-contraste.spec.ts`, `la-app-es-en-ingles.test.ts`, los
  dos `tsc` de CI. Los tests de `MemoryGraphPanel`, `MemoriesList`, `MemoryMarkdown` y de
  la vista del 19-10 que se borran con sus componentes se reemplazan por los de arriba: lo
  que cubrían (wikilinks, backlinks, chips por tipo, edición, borrado, conectar) tiene que
  seguir cubierto.

## 9. Fuera de alcance

- Memory settings, idioma y tema claro (subproyectos 2–4).
- La TUI del plugin y el panel de la extensión (sólo se deja el requisito de §6).
- Varios paneles divididos en el centro (split view de Obsidian): una sola fila de pestañas.
- Recordar pestañas entre reinicios.
- Cambiar la resolución de wikilinks o la búsqueda de la app (`crossProjectMemories` sigue
  con frase exacta).
