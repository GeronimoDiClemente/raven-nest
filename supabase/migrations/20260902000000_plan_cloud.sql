-- Corte comercial del 2026-09-02: `pro` pasa a llamarse `cloud`.
--
-- Los perfiles en planes pagos son asignaciones manuales de testeo: cero de ellos tiene una
-- suscripción de Stripe detrás (verificado el 2026-09-02, `stripe_subscription_id` nulo en
-- toda la tabla). Por eso esto es un UPDATE y no una migración con período de gracia: no hay
-- un solo cobro que romper, y es reversible con el UPDATE inverso.
--
-- Medido el 2026-09-02: 83 perfiles — 66 `free`, 16 `team`, 1 `pro`. O sea que esto toca UNA
-- fila. `team` se mantiene: sigue existiendo como tier a medida, y los 16 que lo tienen son
-- los testers de las features de equipo.
--
-- `profiles` no tiene check constraint sobre `plan` (verificado contra `pg_constraint`), así
-- que no hay schema que tocar.
update public.profiles
   set plan = 'cloud', updated_at = now()
 where plan = 'pro';
