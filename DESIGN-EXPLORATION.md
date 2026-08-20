# Nest — Exploración visual (worktree `feat/visual-redesign`)

> Objetivo: cambiar **toda la visual** de Nest (forma: layout, tipografía, densidad,
> bordes, componentes) — **manteniendo el negro/dark**. NO es un cambio de colores.
> Este worktree es el espacio dedicado para investigar, jugar y decidir la dirección
> antes de tocar la app de verdad.

---

## 1. En qué están hechos Orca y Superset (stack real)

Verificado desde sus fuentes (no de oído):

### Orca (`github.com/stablyai/orca`) — de su `package.json`
| Capa | Tecnología |
|---|---|
| Framework | **React 19** |
| Componentes | **shadcn/ui** (`shadcn@4`) sobre **Radix UI** (`radix-ui@1.6`) |
| Estilos | **Tailwind CSS v4** (`@tailwindcss/vite`) |
| Íconos | **lucide-react** |
| Command palette | **cmdk** |
| Utilidades shadcn | class-variance-authority, clsx, tailwind-merge |
| Estado | **zustand** |
| Drag & drop | **@dnd-kit/core + sortable**  ← *igual que Nest* |
| Toasts | sonner · Color picker: react-colorful |
| Terminal/editor | xterm + monaco  ← *igual que Nest* |
| Build | Vite (rolldown) + electron-vite + Electron 43 |

### Superset (`github.com/superset-sh/superset`)
- Electron, monorepo (desktop / CLI / web / docs / admin / API).
- **UI compartida construida sobre shadcn/ui + Tailwind CSS v4.**
- CLI aparte con Ink + Commander + tmux.

### La conclusión que importa
**Orca y Superset usan la MISMA fundación: `shadcn/ui + Tailwind + Radix`.**
Es el stack estándar-de-la-industria para apps con ese look pro/limpio. No inventaron
nada raro — la prolijidad viene de tener un **sistema de componentes** (variantes,
tokens, primitives accesibles de Radix) en vez de CSS suelto.

---

## 2. Dónde está parada Nest hoy (y el gap)

- **React + CSS plano escrito a mano** — un solo `src/styles/global.css` de **~11.000 líneas**.
- **Sin Tailwind. Sin shadcn. Sin librería de componentes.** Cada botón/tab/badge está
  estilado a mano, sin variantes reutilizables ni primitives.
- Comparte con Orca lo de abajo (xterm, monaco, **@dnd-kit**) — la diferencia es **puramente la capa de UI/estilo**.

**Por eso cuesta que Nest se vea "tal cual Orca":** no es un color, es que ellos tienen
un **design system con componentes**, y Nest tiene CSS artesanal. El look pro sale del
sistema, no de la paleta.

---

## 3. Dos rutas para cambiar la visual (la decisión grande)

### Ruta A — Adoptar shadcn/ui + Tailwind (lo que hacen los dos competidores)
- **Qué es:** meter Tailwind v4 + shadcn/ui en Nest y migrar los componentes (tabs,
  sidebar, botones, badges, dialogs) a componentes shadcn.
- **Pro:** el mismo motor de prolijidad que Orca/Superset; variantes consistentes;
  Radix da accesibilidad; enorme ecosistema de componentes listos para copiar.
- **Contra:** es una **migración grande** (convivir Tailwind con las 11k líneas de CSS,
  ir pantalla por pantalla). Se puede hacer incremental (empezar por el chrome:
  titlebar, sidebar, tabs).
- **Es la ruta que iguala a los competidores.**

### Ruta B — Refinar el CSS plano actual
- **Qué es:** sin cambiar de stack, retocar tipografía / densidad / bordes / radios /
  forma en el `global.css` que ya existe.
- **Pro:** rápido, sin dependencias nuevas, cero migración.
- **Contra:** techo más bajo — seguís sin sistema de componentes; la consistencia
  depende de disciplina manual. Mejora el look pero no te da "la máquina" de ellos.

> **Recomendación:** si el objetivo es jugar en serio con "toda la visual" y acercarse
> a Orca/Superset, **Ruta A** (incremental). Si es solo un lavado de cara rápido, Ruta B.
> El **design-lab** de abajo sirve para decidir la DIRECCIÓN visual antes de comprometer
> la ruta técnica — la dirección elegida se implementa después en A o B.

---

## 4. Dónde jugar con diseños (lugares reales para experimentar)

**Para diseñar componentes estilo shadcn (lo de Orca/Superset):**
- **v0.dev** (Vercel) — describís en lenguaje natural y te genera componentes React +
  shadcn + Tailwind, iterás en vivo. **El mejor "patio de juego"** para este stack.
- **ui.shadcn.com** — los componentes base oficiales (bloques, ejemplos, dashboard).
- **21st.dev** y **originui.com** — galerías enormes de componentes shadcn copy-paste.
- **tweakcn.com** — controla tokens shadcn: además de color, **radius y tipografía**.

**Para inspiración de producto (apps reales):**
- **Mobbin** — screenshots de apps top (patrones UX/UI reales).
- **Godly (godly.website)** y **Land-book** — inspiración de alta gama.

**Para el "por qué" del pulido:**
- **Refactoring UI** (libro/principios) — espaciado, jerarquía, densidad.

**Para probar sobre la forma de Nest, sin tocar la app:**
- El **`design-lab.html`** de este worktree (siguiente sección).

---

## 5. El design-lab local (`design-lab.html`)

Un HTML self-contained (abrilo local, sin server) que renderiza **el panel de Nest**
(titlebar + sidebar + 3 panes) y te deja **flipear entre estilos VISUALES** — todos con
la **misma paleta oscura**, cambiando solo la **forma**:

- **Nest (actual)** — baseline.
- **Linear** — denso, tipografía tight, hairline borders, radios chicos, labels con tracking.
- **Mono Terminal** — todo monoespaciado, esquinas casi rectas, máxima densidad.
- **Soft Modern** — más aire, radios grandes, separadores suaves (menos cajas).
- **Brutalist** — radio 0, bordes gruesos, pesos altos, alto contraste estructural.

Cada uno cambia **fuente, tamaños, pesos, tracking, espaciado, bordes y radios** — NO los
colores. Sirve para elegir la **dirección de forma**; después la implementamos en la app
(Ruta A o B).

**Abrir:** doble clic en `design-lab.html`, o desde la terminal:
`start design-lab.html` (Windows).

---

## 6. Próximos pasos sugeridos

1. Abrí `design-lab.html` y elegí 1–2 **direcciones de forma** que te gusten.
2. Paralelo: jugá en **v0.dev** describiendo un pane/sidebar de Nest para ver el estilo
   shadcn aplicado a nuestros componentes.
3. Decidí la **ruta técnica** (A: adoptar shadcn/Tailwind incremental · B: refinar CSS plano).
4. Con dirección + ruta elegidas, implementamos sobre la app real (HMR) en este worktree,
   empezando por el chrome (titlebar → sidebar → tabs → pane headers).

---

## Fuentes
- Orca — repo y package.json: https://github.com/stablyai/orca
- Superset — repo (AGENTS.md, stack): https://github.com/superset-sh/superset
- Superset — blog técnico: https://superset.sh/blog/terminal-daemon-deep-dive
- Guía Electron-Vite + Tailwind + shadcn: https://blog.mohitnagaraj.in/blog/202505/Electron_Shadcn_Guide
- Starter Electron+React+TS+Tailwind+shadcn: https://dev.to/alexdevson/the-electron-starter-kit-i-wish-existed-earlier-electron-react-typescript-tailwind--4kfd
