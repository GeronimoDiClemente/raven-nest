# Runbook: una versión publicada rompió

**Regla: siempre se arregla hacia adelante.** electron-updater no hace downgrade, así que no
existe "volver a la versión anterior" para quien ya actualizó. Lo que sí se puede es frenar
que la versión siga llegando y sacar otra más alta lo antes posible.

## 1. Frenar la difusión (minutos)

```bash
gh workflow run rollout.yml --repo GeronimoDiClemente/raven-nest -f version=X.Y.Z -f porcentaje=0
```

Reescribe `stagingPercentage: 0` en los `latest*.yml` de la release: ninguna instalación que
todavía no la bajó la va a bajar. Las que ya la bajaron pero no reiniciaron la instalan al
salir (`autoInstallOnAppQuit`), así que cuanto antes, mejor.

Verificar: `gh release download vX.Y.Z --pattern 'latest*.yml' -O -` muestra
`stagingPercentage: 0` en los tres.

## 2. Si la versión rota impide usar la app

Subir `min_version` en `min-version.json` de `main` a la versión del arreglo **una vez
publicada**. Las apps lo leen al arrancar (`enforceMinVersion` en `electron/main.ts`) y, si
están por debajo, muestran un aviso con el link de descarga y se cierran. Es un martillo:
sólo cuando seguir usando la versión rota es peor que no poder usar Nest hasta reinstalar.

## 3. Sacar el arreglo

- Si el arreglo es chico: commit en `main` y bump de versión (X.Y.Z+1). `release.yml` corre
  el CI entero antes de buildear.
- Si no hay arreglo rápido: revertir los commits que rompieron, y publicar el código viejo
  como X.Y.Z+1. La versión siempre sube.

Ojo con la base local de memoria: si la versión rota subió `SCHEMA_VERSION`
(`electron/memory-store.ts`), el código viejo republicado no abre esa base (la memoria
queda apagada esa sesión). En ese caso el arreglo tiene que salir hacia adelante, no
revirtiendo el esquema.

## 4. Si rompió el servidor de sync

- Railway permite redeployar el deploy anterior desde el dashboard. Las migraciones de
  `server/migrations/` sólo van para adelante: el código viejo tolera las aditivas, no una
  destructiva (ver "Orden de despliegue" en `server/README.md`).
- Antes de un deploy con migración, backup manual (`server/README.md`, sección de backups).

## 5. Después

- Liberar la versión del arreglo: si salió con el rollout normal llega a todos; si se usó
  el paso 1 con ella, `porcentaje=100`.
- Contar qué pasó y qué test lo hubiera agarrado, y agregarlo.
