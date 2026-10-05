FROM node:22-alpine

# `postgresql18-client` trae pg_dump y pg_restore, que el backup diario corre como proceso
# hijo. Pinneado porque un pg_dump MÁS VIEJO que el servidor se niega a correr: la base de
# producción (`nest-memory-sync`) es Postgres **18**. Hasta el 2026-10-05 esto decía 16 —
# era cierto para el proyecto viejo— y el backup habría fallado en cuanto se cargara R2. Un
# pg_dump 18 sí dumpea servidores más viejos, así que subir el número es lo seguro. Si la
# base pasa a 19, este número sube con ella.
RUN apk add --no-cache postgresql18-client

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
# `scripts/` no estaba en la imagen: por eso el modo remoto de mint-device-token.mjs se pipea
# por stdin. Ese truco NO sirve para restore-check.mjs, que importa de `../src/` — un script
# leído por stdin no tiene desde dónde resolver esa ruta. Y la restauración probada de §11.3
# hay que poder correrla contra la base de producción, que no tiene endpoint público: la única
# forma es adentro del contenedor.
COPY scripts ./scripts
ENV NODE_ENV=production
EXPOSE 8080
CMD ["npx", "tsx", "src/index.ts"]
