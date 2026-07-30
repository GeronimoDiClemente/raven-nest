---
name: nest-ui
description: Sistema de diseño de Nest. Invocar al construir o EDITAR cualquier UI del renderer (React/CSS en src/). Estética sobria dark tipo superset.sh / Warp, anclada a los tokens de src/styles/global.css.
---

# Nest UI — sistema de diseño

## Cuándo usar
Cualquier trabajo visual en el renderer: componentes nuevos, paneles, estados,
o retoques de estilo. Si tocás JSX con clases o `global.css`, esta skill aplica.

## Norte estético
**Sobrio pero lindo.** Dark, denso pero respirado, tipo terminal/IDE moderno.
Referencias: **superset.sh** y **Warp**. Restraint > decoración: el color es
acento, no protagonista. La calidad se nota en el detalle (espaciado consistente,
hover sutil, jerarquía tipográfica, estados vacíos cuidados), no en el ruido.

> ⚠️ Esta skill es lo **opuesto** a `frontend-design` (que empuja a estéticas
> bold e irrepetibles). Nest prioriza **consistencia** con su sistema existente.
> No apliques esa ética acá.

## Tokens — fuente de verdad: `src/styles/global.css` `:root`
Usar SIEMPRE las variables, nunca hex sueltos.

| Rol | Variable | Valor |
|-----|----------|-------|
| Fondo app | `--bg-app` | `#000000` |
| Superficie | `--bg-surface` | `#0a0a0a` |
| Elevado | `--bg-elevated` | `#111111` |
| Borde | `--border` | `#1e1e1e` (1px, bajo contraste) |
| Texto primario | `--text-primary` | `#e8e8e8` |
| Texto secundario | `--text-secondary` | `#888` |
| Texto muted | `--text-muted` | `#555` |
| Acento | `--raven-blue` | `#0066FF` |
| Acento tenue | `--raven-blue-dim` | `#0066FF44` |

El sub-sistema de paneles de integraciones usa una paleta azulada afín
(`.ip-*`: superficies `#08080a`/`#0c1018`, bordes `#121214`/`#16233b`, texto
`#5a7bb5`). Mantener ese lenguaje al extender esos paneles.

## Escala y forma
- **Spacing:** múltiplos de 4 (4 · 8 · 12 · 16 · 20 · 24). Densidad de IDE.
- **Radios:** 6px controles/botones · 8–10px cards y paneles · 12px contenedores grandes.
- **Elevación:** por superficie un paso más clara (`app → surface → elevated`),
  NO por sombras pesadas. Sombras: sólo halos muy sutiles si hacen falta.
- **Bordes:** 1px `--border`. La separación se logra con borde + fondo, no con líneas gruesas.
- **Jerarquía:** por tamaño/peso tipográfico y color de texto (primary/secondary/muted),
  no por cajas ruidosas.

## Tipografía
- **UI:** la fuente base del body (system sans, `inherit`).
- **Mono** (`'JetBrains Mono'`, `'SF Mono'`, `'Cascadia Code'`): SOLO para código,
  keys/IDs, nombres de rama, paths, valores técnicos. Nunca para prosa de UI.
- **Tamaños:** títulos 13–17px / 650 · cuerpo 12.5–13px · meta y subs 10.5–11px.
- **Detalles:** letter-spacing `-0.01em` en títulos grandes; labels de sección en
  `uppercase` con tracking `.08–.09em` y color `--text-muted`.

## Color de acento (`--raven-blue`)
- Acciones primarias, estado activo/seleccionado, focos. **Con mesura.**
- `connected`/success: verde suave. `error`: rojo desaturado sobre fondo `#1a0e0e`
  con borde `#3a1c1c` (ver `.ip-error`).
- **Marcas de integración:** chip tintado con `--brand` (color oficial de la marca)
  + logo SVG real. Monocromo vía `currentColor`; multicolor con fills propios.
  Fuente: `src/lib/plugins/brandLogos.tsx` + `BrandLogo`.

## Movimiento
- Transiciones **120–180ms ease** en hover y cambios de estado.
- Sutil: cambiá `border-color` y `background` un nivel. Sin escalas, bounces ni
  animaciones de entrada llamativas en UI de trabajo.

## Estados — nunca omitir
- **Empty:** mensaje centrado, `--text-muted`, ~13px, una acción si aplica.
- **Loading:** mismo patrón sobrio (texto, no spinners agresivos).
- **Error:** banda inline con `Retry`, no toast agresivo.

## Anti-patrones (lo que Nest NO es)
- Gradientes morados, neón, glassmorphism pesado.
- Sombras grandes / cards con mucho relieve.
- Colores saturados como fondo de superficie.
- Mono en textos de UI. Hex sueltos en vez de tokens.

## Checklist antes de dar por hecho
- [ ] Usé tokens, no hex sueltos (salvo la paleta `.ip-*` ya establecida)
- [ ] Spacing en múltiplos de 4; radios de la escala
- [ ] Mono solo en código/keys/paths
- [ ] Hover/estado con transición 120–180ms sutil
- [ ] Empty / loading / error cubiertos
- [ ] Consistente con las clases `.ip-*` / `.tk-*` / `.integration-*` existentes
