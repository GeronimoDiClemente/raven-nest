-- Spec 2b-2 §4.7: al bajar de plan, el usuario elige qué proyecto sigue sincronizando.
--
-- Nullable y sin default: null = "no eligió", y entonces siguen los más viejos (por
-- `projects.id`: la tabla no tiene `created_at`). Queda guardado aunque el usuario vuelva a
-- pagar: con el tope alto la regla no aplica y la columna no tiene efecto.
alter table users add column if not exists kept_project_key text;
