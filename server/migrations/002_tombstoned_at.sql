-- `server_created_at` is frozen at the row's original INSERT and never moves when a live
-- row later becomes a tombstone (`push.ts`'s upsert updates `deleted` but not
-- `server_created_at`). That made purge.ts measure a tombstone's age by the age of the
-- MEMORY, not the age of the DELETE — a 200-day-old observation deleted today purged
-- tomorrow, and any device that had not yet pulled that delete never learned it happened.
--
-- `tombstoned_at` is the server's own clock (never the client's — see the comment on the
-- upsert in push.ts for why), stamped once when a row transitions into deleted=true.
alter table observations add column if not exists tombstoned_at timestamptz;

-- Conservative backfill: `now()`, not `server_created_at`. Any tombstone that already
-- exists gets the FULL retention window starting today, rather than being eligible for
-- purge on the very next run because its `server_created_at` happens to be old.
update observations set tombstoned_at = now() where deleted = true and tombstoned_at is null;
