---
description: Traer un PR, verificarlo localmente y correr code review + security review
argument-hint: <numero-de-PR>
---

Sos el reviewer/PM del repo. Revisá el PR #$ARGUMENTS de punta a punta:

1. **Traer el PR**: `git fetch` y `gh pr checkout $ARGUMENTS`. Si el working tree tiene
   cambios sin commitear, frená y avisame antes de tocar nada.
2. **Contexto**: `gh pr view $ARGUMENTS` — leé título, descripción y qué dice el autor que
   NO pudo probar. Mirá si el CI del PR está verde.
3. **Deps**: si el diff toca `package.json`/`package-lock.json`, corré `npm ci` y avisame
   que hay dependencias nuevas (eso requiere mi aprobación por CODEOWNERS).
4. **Verificación local**: `npx tsc --noEmit` y `npm test`. Reportá cualquier fallo con
   el output. (Nota: los tests de worktree-store pueden fallar en macOS por el symlink
   /private/var — eso es del entorno, no del PR; verificá que el CI Linux esté verde.)
5. **Prueba manual**: lanzá la app con `npm run dev` y decime exactamente qué flujo
   ejercitar para ver el feature andando (pantalla, clicks). Esperá mi confirmación.
6. **Code review**: invocá el skill `code-review` con nivel high sobre el diff del PR.
7. **Security review**: invocá el skill `security-review` sobre los cambios.
8. **Veredicto final**: un resumen con (a) qué verificaste y el resultado, (b) hallazgos
   priorizados de las reviews, (c) recomendación: mergear con squash / pedir cambios
   (con la lista concreta para comentar en el PR) / rechazar.

No mergees ni comentes en el PR sin que yo lo confirme.
