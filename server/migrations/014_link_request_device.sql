-- Login sin Nest (spec 2026-11-02-login-y-compra-sin-nest §3): la página que aprueba
-- muestra QUÉ máquina pidió el código —nombre y sistema— para que la persona note un código
-- que no salió de su terminal. Nullables: un cliente viejo no los manda y el pedido vale igual.
alter table link_requests add column if not exists device_name text;
alter table link_requests add column if not exists platform text;
