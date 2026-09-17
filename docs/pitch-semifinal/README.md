# Pitch — Semifinal UCAECE StartLab 2026

Deck de 11 slides y los guiones de los tres. Estado al **2026-09-17**.
Antes de esto el deck vivía sólo en `~/Downloads` y no estaba en git.

## Qué hay acá

| Archivo | Qué es |
|---|---|
| `Nest-Pitch-Semifinal.pptx` | **Lo que se presenta.** 11 slides 16:9 (13,333 × 7,5 in), una imagen a sangre por slide a 2560×1440. No depende de fuentes instaladas, así que no se rompe en la máquina del evento. Quién habla va en las notas del orador |
| `Nest-Pitch-Semifinal.pdf` | Respaldo, por si el PowerPoint del evento falla |
| `Guion-<nombre>.pdf` | Una carilla en **puntos**, para tener en la mano en el escenario. Incluye "si preguntan" |
| `Guion-<nombre> (para aprender).pdf` | Una carilla con el **texto completo**, para memorizarlo. Sin el bloque de preguntas |
| `fuentes/deck.html` | El deck. Autocontenido: fotos y logo embebidos en base64 |
| `fuentes/gen-guiones-*.py` | Generan los guiones en HTML; después se imprimen a PDF |

## Reparto (180 s)

| Quién | Slides | Tiempo |
|---|---|---|
| Gerónimo Di Clemente · CEO | 01, 02, 03, 10, 11 | 75 s |
| Bautista Martínez Vuoto · CMO | 04, 05, 06 | 55 s |
| Matías Labari · CTO | 07, 08, 09 | 50 s |

El nombre de quien habla está impreso en el pie de cada slide (`.foot .habla`).
⚠️ Los segundos son un reparto propuesto, **nunca cronometrado**, y no incluyen los
~10-15 s que se comen los tres traspasos.

## Cómo regenerar todo

El deck se imprime a PDF y de ahí salen las imágenes del PPTX:

```bash
# 1. servir el deck (el charset importa, ver abajo)
cd docs/pitch-semifinal/fuentes && python -m http.server 8731

# 2. deck -> PDF (ojo: la ruta de --print-to-pdf con / , no con \)
chrome --headless=new --disable-gpu --no-pdf-header-footer --no-margins \
  --print-to-pdf="C:/ruta/pitch.pdf" http://127.0.0.1:8731/deck.html

# 3. PDF -> PNG 2560x1440 -> PPTX  (pymupdf + python-pptx)
#    dpi=192 sobre una pagina de 960x540 pt da exactamente 2560x1440
```

Los guiones: `python fuentes/gen-guiones-puntos.py` y `gen-guiones-texto.py` escriben
los HTML, y cada uno se imprime a PDF A4 con el mismo `chrome --headless`.

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
- **La definición de "piloto"** (equipo de 5+ devs, 90 días, días 1-30 local gratis / 31-90 Cloud
  sin cargo / día 91 deciden si pagan) **no existía en ningún lado: se escribió el 17-09**. Está en
  los guiones de Gerónimo y Bautista. Si el equipo la tenía pensada distinta, hay que cambiarla.
- **Los 400 equipos del SOM** siguen sin revisarse y están conservadores en contra nuestro.
- Sin decidir: sacar `nestmux.com` de la portada (en el cierre sí sirve, en la portada compite
  con el título) y recortar detalle de los slides 3 y 8 — la mitad del feedback de Franco que
  quedó sin hacer, porque agrandamos la tipografía pero no podamos contenido.
