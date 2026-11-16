-- `obs_pull` (001) indexa exactamente lo mismo que el índice que Postgres ya crea para
-- `unique (project_id, project_seq)` de la misma tabla: mismas columnas, mismo orden. Cada
-- insert y cada update de `observations` mantenía los dos. El planner usa el de la
-- restricción igual de bien para el pull (`project_id = … and project_seq > …`).
drop index if exists obs_pull;
