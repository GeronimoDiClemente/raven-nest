FROM node:22-alpine

# `postgresql16-client` trae pg_dump y pg_restore, que el backup diario corre como proceso
# hijo. Pinneado a 16 porque un pg_dump MÁS VIEJO que el servidor se niega a correr, y la base
# de producción es Postgres 16: sin el número, un rebuild futuro podría traer un cliente 15 y
# el backup dejaría de existir en silencio.
RUN apk add --no-cache postgresql16-client

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
