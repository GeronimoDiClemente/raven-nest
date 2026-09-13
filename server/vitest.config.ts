import { defineConfig } from 'vitest/config'

// Standalone config so vitest does not walk up to the repo root's vitest.config.ts
// (this package lives nested inside the raven-nest worktree but is its own project).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    /**
     * Estos tests pegan contra un Postgres REAL en Docker, y son 40 archivos en paralelo. Los
     * 5s de default de vitest estaban calibrados para un suite mucho mas chico: bajo carga,
     * archivos enteros se pasaban del limite y vitest los reportaba como "skipped" —un suite
     * que falla en masa, en tests sin relacion entre si, que pasan cuando los corres solos.
     * Pasó dos veces el 2026-09-13 y las dos mandó a buscar el problema al lugar equivocado.
     *
     * Subirlo NO tapa un test lento de verdad: el que tarda 20s sigue siendo un problema y se
     * ve en la salida. Lo que evita es que la contencion entre archivos se lea como una falla
     * del codigo.
     */
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
