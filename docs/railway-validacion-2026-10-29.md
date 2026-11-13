# Nest Memories sync: ¿seguir en Railway o mudar? (2026-10-29)

Leyenda: [V] verificado en fuente primaria/oficial, [S] fuente secundaria, [NV] no verificado / mi estimación.

## Hallazgo que cambia la conversación: incidente de seguridad de Railway, 20-22 oct 2026

- [V] Informe preliminar de Railway (https://blog.railway.com/p/preliminary-report-october-security-incident): un atacante entró a sistemas internos, consultó y **descifró variables de entorno de un subconjunto de workspaces** (dice "como máximo 1,85 %"; el informe también dice "~100.000 workspaces", cifras que no cierran entre sí: lo marco). Obtuvo credenciales de CI y artefactos con acceso a API. Ventana: 20-oct 13:58 UTC a 22-oct 03:32 UTC. Cerraron sesiones OAuth, invalidaron tokens de API, rotaron credenciales de buckets.
- [V] Railway **recomienda rotar todas las variables guardadas en Railway** y "quitar el acceso público a bases de datos" (la nuestra ya no lo tiene). No descartan acceso a código fuente de usuarios (informe final pendiente). No dicen si se leyó contenido de volúmenes/bases.
- [V/S] Outage asociado: 62 h 45 min (dashboard, API, CLI, builds pausados en todas las regiones, incluso Enterprise; el sitio de soporte también cayó). Fuente: https://uptimerobot.com/is-it-down/railway/2026-10-21/ (S) y status https://status.railway.com/incident/QH8L8B3E (aparece en búsqueda; no lo abrí). Altas nuevas pausadas.
- Cobertura secundaria: https://thehackernews.com/2026/10/railway-says-intruder-may-have-accessed.html
- **Implicancia para nosotros**: el E2EE protege el contenido de las memorias, pero las variables de entorno del servicio (DATABASE_URL, credenciales de R2 del pg_dump, claves/secretos de Supabase si están ahí, cualquier secreto HMAC/JWT del servidor) estaban en Railway y hay que tratarlas como potencialmente expuestas. Rotarlas es independiente de la decisión de mudarse.

## Otro incidente grande
- [S] 19-may-2026: suspensión automática de la cuenta GCP de producción de Railway, ~8 h de caída de plataforma (control plane, API, y por caché de rutas también workloads en Metal/AWS). Postmortem de Railway del 20-may (resumen: https://www.plushcap.com/content/railway/blog/railway-incident-report-may-19-2026-gcp-account-suspension). No leí el original.
- [S] 11-feb-2026: sistema anti-abuso mal configurado terminó deployments legítimos (~3 % de la flota). https://www.plushcap.com/content/railway/blog/railway-incident-report-february-11-2026
- [S] 18-21 feb: DDoS / caída de Cloudflare (título en plushcap; no abrí el detalle).
- Tres incidentes mayores en ~9 meses, dos de ellos de plataforma completa.

## Railway: hechos
| Tema | Dato | Fuente |
|---|---|---|
| Precio | Hobby $5/mes (incluye $5 de uso), Pro $20/mes (incluye $20 de uso), Enterprise a medida. Uso por encima se factura por recurso. Pro: si es por asiento o por workspace, las fuentes discrepan [NV] | [V] https://docs.railway.com/reference/pricing/plans |
| Límites Hobby | 5 GB de volumen, 48 GB RAM/48 vCPU máx por servicio, retención de imágenes 72 h | [V] misma página |
| Soporte | Business Class como add-on de Pro; incluido en Enterprise | [V] |
| SLA | Sólo contractual en Enterprise ("SLAs" sin porcentaje publicado); no hay SLA publicado para Hobby/Pro | [V] docs enterprise + [S] |
| Backups | Backups de volumen gestionados: diario (retención 6 días), semanal (1 mes), mensual (3 meses), incrementales. PITR opt-in vía pgBackRest a un bucket, ventana ~4 semanas, sin cargo aparte (se paga bucket/egress); restore crea servicio hermano, cutover manual | [V] https://railway.com/guides/postgres-backups-restores y https://docs.railway.com/volumes/point-in-time-recovery |
| HA | Postgres HA (Patroni + etcd + HAProxy), failover ~5 s; restaurar un HA da un fork single-node. Costo: varias réplicas = multiplica el uso [NV precio exacto] | [S/V] docs CLI/PITR, release CLI 5.33 |
| Regiones | US West (California), US East (Virginia), EU West (Ámsterdam), SE Asia (Singapur). **Sin Sudamérica** | [V] https://docs.railway.com/reference/regions |
| SOC 2 | SOC 2 Type II y SOC 3 declarados, informes en trust.railway.com (changelog 2025-08-01). Informe no visto | [V] changelog + docs compliance; informe [NV] |
| Tarjeta argentina | No verifiqué si Railway acepta la tarjeta / si hay recargo de impuestos | [NV] |
| Lock-in | Bajo: Docker + Postgres estándar; pg_dump a R2 propio |

## Comparativa (costos mensuales para: 1 servicio chico + Postgres chico, ~10-20 GB; estimaciones mías salvo donde hay link)

| Opción | Costo estimado | SLA publicado | Backups / PITR | HA | Sudamérica | SOC 2 | Ops |
|---|---|---|---|---|---|---|---|
| **Railway Hobby** | ~$5-15 | ninguno | volumen diario/sem/mes + PITR opt-in | no (Pro?) | no | org sí (informe a pedido) | muy bajo |
| **Railway Pro** | ~$20-40 (+HA multiplica) | ninguno (sólo Enterprise) | idem + PITR | sí (Patroni) | no | idem | muy bajo |
| **Render** (Pro workspace $25 plano desde abr-2026 [S: temps.sh/blog/render-pricing-2026]) | ~$25 + web ~$7-25 + Postgres desde ~$6-20 [NV exacto] | sólo Enterprise [S] | PITR/ventana según plan del workspace [S] | sí en instancias Pro [S: render.com/docs/postgresql-refresh] | no (Oregon, Ohio, Virginia, Frankfurt, Singapur) [V: render.com/docs/regions] | Type 2 desde feb-2023, informe sólo Org/Enterprise [S] | bajo |
| **Fly.io** | ~$5-15 cómputo (shared-cpu 1GB $6,70 [V]) + Managed Postgres desde $38 + $0,28/GB [V: docs.fly.io/about/pricing]; soporte Standard $29 | no encontrado [NV] | volúmenes: snapshot diaria 5 días [V]; MPG: [NV] | MPG: [NV] | gru (São Paulo) [NV, no verifiqué] | [NV] | medio |
| **AWS** ECS Fargate/App Runner + RDS | RDS t4g.micro sa-east-1 ~$25 single-AZ, ~$50 Multi-AZ [S: sparecores.com/database/aws/db.t4g.micro]; us-east ~$12 single. + Fargate ~$10-20 + ALB ~$18 + storage/transfer. Total ~$60-120 | RDS Multi-AZ 99.95 % [NV, de memoria; no lo verifiqué] | backups automáticos hasta 35 días + PITR [NV, de memoria] | Multi-AZ | sí (sa-east-1) | sí (AWS) [NV] | alto (IAM, VPC, TLS) |
| **GCP** Cloud Run + Cloud SQL | Cloud SQL 1 vCPU ~$49 (US) / ~$74 (São Paulo) [S: bytebase]; Cloud Run ~$0-10. Total ~$60-100 | Cloud SQL 99,95 % [S, no oficial]; instancias shared-core no cubiertas [S] | PITR sí [NV] | HA regional [NV] | sí (southamerica-east1) | sí [NV] | medio-alto |
| **DigitalOcean** App Platform + Managed PG | PG 1 GiB/1 vCPU $15,15 + $0,215/GiB [V: digitalocean.com/pricing/managed-databases]; App Platform ~$5-12. Total ~$25-45 | PG: 99,5 % sin standby, 99,95 % con standby [S, discrepa con otra fuente que dice 99,99 %]; App Platform [NV] | PITR hasta 7 días [V: docs.digitalocean.com] | standby, misma región; ojo: DO retira "standby" en planes Standard >4 GiB desde 30-nov-2026 [V quickstart docs] | no [NV, no vi lista] | [NV] | bajo-medio |
| **Hetzner VPS propio** | ~€4-8 (subió 30-37 % en abr-2026 [S]) + backups | ninguno | lo armás vos (pg_dump/pgBackRest) | no | no (UE/US) | [NV] | alto, todo tuyo |
| **Neon / Supabase** (Postgres separado) | Supabase Pro $25 + PITR add-on ~$100 (7 días) [S]; Neon Scale: precios en conflicto entre fuentes [NV] | Neon Scale 99,95 % [S, conflicto]; Supabase Pro: [NV] | PITR (Supabase add-on) | según plan | Supabase São Paulo [NV]; Neon sin SP [S] | Neon Type 2 [S]; Supabase [NV] | bajo (sólo cómputo aparte) |

Notas: Supabase ya es proveedor de auth (us-east-2); sumarle la base concentra riesgo en un solo proveedor pero reduce un vendor. Todo lo marcado [NV] hay que confirmarlo en la página oficial antes de decidir.

## Recomendación

(a) **Beta cerrada ahora: quedarse en Railway, pero endurecido esta semana.**
1. Rotar todos los secretos del servicio: DATABASE_URL/contraseña de Postgres, credenciales de R2 del pg_dump, cualquier secreto de Supabase o de firma/HMAC del servidor, tokens de deploy/GitHub. Revisar logs por actividad rara. Es obligatorio sin importar lo demás.
2. Probar el restore de verdad (pg_dump de R2 a un Postgres limpio y levantar el servidor contra él). Un backup nunca restaurado es una hipótesis. Hacerlo ahora, con el drill documentado.
3. Habilitar el PITR de Railway y los backups de volumen (sin costo aparte) y mantener el dump a R2: es la única copia que sobrevive a perder el proyecto/cuenta.
4. Pasar a Pro (~$20) por límites (Hobby: 5 GB de volumen) y para tener soporte add-on; no compra SLA.
5. Esperar el informe final de Railway (código fuente, alcance) y re-leerlo.

Por qué no mudar ya: tráfico de decenas de usuarios, contenido E2EE (el peor caso de fuga de Railway no expone memorias en claro), y migrar en plena beta cuesta tiempo de un equipo de 1-2. Pero la confianza bajó: tres incidentes grandes en 9 meses, uno de seguridad con secretos descifrados hace una semana. No hay SLA publicado para Pro, así que "quedarse" es una decisión de riesgo aceptado, no de garantía.

(b) **Cuando aparezca el primer cliente que pida SLA / SOC 2 / residencia:** mudar a un proveedor con SLA publicado para la base: AWS (ECS Fargate o App Runner + RDS Multi-AZ) o GCP (Cloud Run + Cloud SQL HA). Región: dado que Supabase Auth está en us-east-2, desplegar en us-east-2 salvo que el cliente exija residencia; sa-east-1 duplica el costo [S]. Alternativa liviana si el SLA pedido es modesto: Render Pro o DigitalOcean (PG con standby). Mudanza: CNAME de sync.nestmux.com + pg_dump/restore (de ahí que el drill del paso 2 sirva doble).

**Disparadores concretos para mudar antes:** (1) el informe final confirma acceso a código/datos de volúmenes o hay una segunda caída >4 h; (2) un cliente exige SLA, SOC 2 del proveedor de cómputo o residencia por escrito; (3) el drill de restore o el PITR de Railway fallan; (4) Railway cambia pricing/límites de forma que el costo supere ~$60/mes sin ganar garantías.

## No pude verificar
SLAs de AWS/GCP/DO App Platform/Fly/Supabase en páginas oficiales; precios de Fargate/App Runner/Cloud Run; regiones de Fly y Supabase; si Railway acepta tarjeta argentina; si Pro de Railway es por asiento o por workspace; costo real de HA en Railway; el contenido del informe SOC 2 de Railway; el postmortem original del 19-may; si el servidor nuestro tenía secretos de Supabase en variables de Railway (no investigué el servicio, como pediste). Varias cifras de costo son mis estimaciones.
