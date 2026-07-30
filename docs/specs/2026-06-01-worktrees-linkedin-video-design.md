# Video LinkedIn — Worktrees → Push a GitHub (diseño)

Fecha: 2026-06-01 · Branch: feat/tutorial-interactivo · Herramienta: **HyperFrames** (no Remotion — no disponible en el entorno)

## Objetivo

Video de marketing para LinkedIn que muestra el flujo estrella de Nest: desde **My Repos**, spawnear **git worktrees** aislados por tarea y **pushear a GitHub** sin salir de la ventana. Mockup 100% animado (UI recreada, no screen recording), fiel a la estética de nestmux.com.

## Parámetros

- **Formato:** 16:9, 1920×1080, ~60s.
- **Audio:** voiceover TTS (inglés) + captions sincronizados + música suave de fondo.
- **Idioma:** video en inglés (lo maneja el creador de contenido EN). Post de LinkedIn entregado en ES + EN.
- **Destino:** LinkedIn (feed landscape).

## Estética (fiel a la app)

- Fondo `#000000`, superficies `#0a0a0a`, elevated `#111111`, borde `#1e1e1e`.
- Acento azul `#0066FF`. Repo en verde `#00CC44`. Branch badge monospace `#555`.
- Status dots worktree: gris/amarillo/verde/rojo. Diff chips: `+` verde / `−` rojo. PR chip azul `#xxx`.
- Tipografía: Inter (UI) + monospace (Consolas/SFMono) para branches/paths.
- Cursor animado que clickea, entradas con stagger, glow azul sutil.

## Storyboard (6 escenas)

| # | t | Pantalla | VO (EN) |
|---|------|----------|---------|
| 1 | 0–7s | Intro logo Nest + glow. Grid 3 panes (Claude/Gemini/Codex) "peleándose" por el repo, glitch rojo. | "You're running Claude, Gemini and Codex in parallel — all fighting over the same repo." |
| 2 | 7–14s | Sidebar "My Repos" se expande; cursor selecciona repo (nombre verde + branch badge). | "Nest fixes that. Pick any repo from My Repos." |
| 3 | 14–30s | Click en **+** de Worktrees. Entran 3 worktrees con stagger: `feat/auth`, `fix/payments`, `chore/refactor`, con dots + slug. | "Spin up a git worktree for every task — each one isolated. Its own branch, its own dependencies, its own dev server." |
| 4 | 30–40s | Diff chips crecen en vivo (`+128 −14`), dots → verde. Dos panes trabajando sin pisarse. | "Three agents, three branches, zero collisions. Watch the changes pile up — live." |
| 5 | 40–53s | Right-click `feat/auth` → menú con **Push to GitHub** resaltado → "Pushing…" → chip **#123** → corte a mock de PR de GitHub. | "When a branch is ready: right-click, Push to GitHub. Your pull request, opened automatically." |
| 6 | 53–60s | Outro: logo Nest, tagline "One window. Every branch. Every agent.", nestmux.com. | "From your repos to GitHub — without leaving the window. Nest. Try it free at nestmux.com." |

## Guion VO (EN, ~110 palabras)

> You're running Claude, Gemini and Codex in parallel — all fighting over the same repo. Nest fixes that. Pick any repo from My Repos. Spin up a git worktree for every task — each one isolated. Its own branch, its own dependencies, its own dev server. Three agents, three branches, zero collisions. Watch the changes pile up — live. When a branch is ready: right-click, Push to GitHub. Your pull request, opened automatically. From your repos to GitHub — without ever leaving the window. Nest. One window. Every branch. Every agent. Try it free at nestmux.com.

## Entregables

1. Proyecto HyperFrames con la composición (`index.html` + assets).
2. Render mp4 1920×1080.
3. Copy del post de LinkedIn en ES y EN.

## Fuera de alcance

- Screen recording de la app real.
- Versión vertical/cuadrada (solo 16:9 por ahora).
- Subtítulos quemados en otro idioma (captions EN dentro del video).
