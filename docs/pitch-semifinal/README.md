# Pitch — UCAECE StartLab 2026

Deck de 11 slides y los guiones de los tres. Estado al **2026-09-24**, versión de la **final**.
La versión de la semifinal está en el commit `71928a6` (`Nest-Pitch-Semifinal.pptx/pdf`).

## Qué hay acá

| Archivo | Qué es |
|---|---|
| `Nest-Pitch-Final.pptx` | **Lo que se presenta.** 11 slides 16:9 (13,333 × 7,5 in), una imagen a sangre por slide a 2560×1440. No depende de fuentes instaladas, así que no se rompe en la máquina del evento. Quién habla y cuántos segundos van en las notas del orador |
| `Nest-Pitch-Final.pdf` | Respaldo, por si el PowerPoint del evento falla |
| `Guion-<nombre>.pdf` | Una carilla en **puntos**, para tener en la mano en el escenario. Incluye "si preguntan" |
| `Guion-<nombre> (para aprender).pdf` | Una carilla con el **texto completo**, para memorizarlo |
| `fuentes/deck.html` | El deck. Autocontenido: fotos y logo embebidos en base64 |
| `fuentes/gen-guiones-*.py` | Generan los guiones en HTML; después se imprimen a PDF |

## Reparto (300 s)

| Quién | Slides | Tiempo |
|---|---|---|
| Gerónimo Di Clemente · CEO | 01, 02, 03, 10, 11 | 75 s + 45 s |
| Bautista Martínez Vuoto · CMO | 04, 05, 06 | 85 s |
| Matías Labari · CTO | 07, 08, 09 | 80 s |

285 s hablados + ~15 s de los tres traspasos = 300 s.
⚠️ Los segundos por bloque son un reparto propuesto, **nunca cronometrado**.

## La pasada de la final (2026-09-24)

Feedback de Franco después de la semifinal, tres puntos: *seguir por el mismo camino*,
*achicar la info que se ve en el power* y *el jurado no es tan técnico, bajen bien la idea*.
Los dos últimos ya habían llegado el 17-09 y habían quedado a medias — esa vez se agrandó
la tipografía pero no se podó contenido, que era lo que pedía.

**Qué se hizo:**

- **Texto en pantalla: de ~7.680 a ~4.950 caracteres (−36 %).** Un slide = una idea + como
  mucho tres apoyos de una línea. El detalle que salió de los slides no se tiró: bajó a los
  guiones y al bloque "Si preguntan", que es donde sirve.
- **Se desjergó todo.** Fuera de los slides: *runtime*, *plugin ciego*, *pane*, *rama*, *diff*,
  *worktree*, *grafo de agentes*, *cifrado del lado del cliente*, *pipeline*, *tokens*,
  `memory-bridge.ts`, `CLAUDE.md`, *VPS / TLS / Postgres*, *2.388 tests*. Se dice "asistentes"
  y no "agentes", "memoria" y no "contexto".
- **El par de slides 02 ↔ 04 es ahora el argumento central**: el mismo diagrama de nodos, en la
  misma posición y a la misma escala, primero como cinco islas sin una sola línea entre ellas y
  después con todo bajando a un único punto. Reemplazó tres paneles de texto repetido en el 02 y
  el párrafo largo del 04.
- El slide 11 ya no cierra con *"y pasar a la final"*, y la portada dice **Final 2026**.

## 🎨 La paleta de los nodos — no cambiarla a ojo

Los tonos de marca (`--accent`, `--amber`, `--violet`) **no sirven** para los nodos: contra la
superficie oscura quedan fuera de la banda de luminosidad y el par ámbar↔verde cae a ΔE 7,2 para
daltonismo protan. Los pasos que sí validan están en `:root` como `--n1/--n2/--n3`:

| Rol | Hex | |
|---|---|---|
| Persona 1 | `#6C79E0` | peor par daltonismo **ΔE 10,5** (objetivo ≥ 8) |
| Persona 2 | `#B58429` | visión normal **ΔE 18,8** (piso 15) |
| Persona 3 | `#D55181` | contraste ≥ 3:1 contra la superficie |
| Memoria | `#2DD08A` | verde de marca, **reservado**: se distingue por tamaño, halo y etiqueta, nunca por color solo |

Si se tocan, re-validar antes de exportar:

```bash
node scripts/validate_palette.js "#6C79E0,#B58429,#D55181" --mode dark --surface "#0E1412" --pairs all
```

(del skill `dataviz`). Los dos clusters grises son "y dos más del equipo": el gris es la salida
correcta cuando hacen falta más series que colores que validen.

## Cómo regenerar todo

```bash
# 1. servir el deck (el charset importa, ver abajo)
cd docs/pitch-semifinal/fuentes && python -m http.server 8731

# 2. deck -> PDF (ojo: la ruta de --print-to-pdf con / , no con \)
chrome --headless=new --disable-gpu --no-pdf-header-footer --no-margins \
  --print-to-pdf="C:/ruta/Nest-Pitch-Final.pdf" http://127.0.0.1:8731/deck.html

# 3. PDF -> PNG 2560x1440 -> PPTX  (pymupdf + python-pptx)
#    dpi=192 sobre una pagina de 960x540 pt da exactamente 2560x1440
```

Los guiones: `python fuentes/gen-guiones-puntos.py` y `gen-guiones-texto.py` escriben
los HTML, y cada uno se imprime a PDF A4 con el mismo `chrome --headless`.
Los generadores compactan solos (`body.denso`) cuando alguien tiene 5 bloques o más:
**una carilla por persona es el requisito**, porque se tiene en la mano en el escenario.

## 🪲 Los 3 bugs de exportación que tenía este deck

Encontrados el 2026-09-17. **Valen para cualquier deck HTML que hagamos**, no sólo para éste.

1. **Faltaba `<meta charset="utf-8">`.** El archivo estaba en UTF-8 válido, pero sin declarar
   el charset. Abierto con `file://` —o servido sin charset en el header— el browser cae al
   encoding del locale (windows-1252) y muestra `Ã¡` donde va `á`. **En el Artifact publicado se
   veía bien** porque ahí el charset viaja en el header HTTP: por eso el bug sólo aparecía al
   exportar en local y nadie lo había visto.

2. **Seis de los once slides se partían en dos páginas** (el PDF salía con **17**). `.slide`
   definía su alto con `aspect-ratio:16/9` + `container-type:size` en vez de un alto explícito,
   y Chrome lo fragmentaba contra el borde de página. Además el `break-after:page` forzado metía
   una página en blanco cuando el slide llenaba la página justo.
   **Fix**: en `@media print`, `height:720px` + `max-height` + `aspect-ratio:auto` +
   `box-sizing:border-box` + `overflow:hidden` + `break-inside:avoid`, y **sacar el
   `break-after:page`** — con el alto exacto la paginación natural da 1 slide = 1 página.

3. **La peor: `@media (max-width:760px)` no estaba limitada a pantalla**, así que también
   aplicaba al imprimir. Apilaba las columnas de los slides 3, 5 y 6 una debajo de otra y ponía
   `container-type:normal`, matando las unidades `cqw`. En el slide de Mercado eso desbordaba y,
   como `.slide` tiene `overflow:hidden`, **se comía el SOM entero y el kicker**: la página salía
   cortada después del SAM. **Fix**: `@media screen and (max-width:760px)`, más
   `html,body{margin:0}` en print (el margen de 8px por defecto del body metía una página en
   blanco al principio).

**Cómo verificarlo sin abrir el browser a mano** — es la receta que encontró los tres:
exportar con `chrome --headless --print-to-pdf` contra un `python -m http.server`, y después
contar páginas, buscar páginas vacías y buscar mojibake (`Ã`, `â€`) con `pypdf`/`pymupdf`.
Contar caracteres por página delata el contenido recortado: el slide de Mercado tenía 367
caracteres cuando debía tener 708.

## Cosas abiertas

- **La foto de Bautista** es una nocturna casual con luces de ciudad, al lado de dos headshots
  de estudio sobre blanco. Se probó duotono y recorte cerrado: ninguno lo arregla, porque el
  problema es el fondo. El fix real es un headshot nuevo.
- **Los 400 equipos del SOM** siguen sin revisarse y están conservadores en contra nuestro: el
  precio bajó a menos de la mitad y el esfuerzo comercial es el mismo.
- **La definición de "piloto"** (5+ programadores, 90 días, 1-30 gratis / 31-90 nube sin cargo /
  día 91 deciden) se escribió el 17-09 y **nunca la confirmó el equipo**. Está en los guiones de
  Gerónimo y Bautista: si la tenían pensada distinta, hay que cambiarla en los dos.
- La carpeta sigue llamándose `pitch-semifinal/` aunque el contenido ya es el de la final.
  Renombrarla a `docs/pitch/` cuando no haya un pitch encima.
