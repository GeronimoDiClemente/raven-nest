create table if not exists users (
  id            uuid primary key,
  email         text,
  plan          text not null default 'free',
  created_at    timestamptz not null default now()
);

create table if not exists devices (
  id            uuid primary key,
  user_id       uuid not null references users(id) on delete cascade,
  name          text not null,
  platform      text,
  token_hash    text not null,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz,
  revoked_at    timestamptz
);
create index if not exists devices_by_user on devices (user_id) where revoked_at is null;
create unique index if not exists devices_by_token on devices (token_hash);

create table if not exists projects (
  id            bigserial primary key,
  user_id       uuid not null references users(id) on delete cascade,
  project_key   text not null,
  display_name  text not null,
  seq_counter   bigint not null default 0,
  unique (user_id, project_key)
);

create table if not exists observations (
  sync_id           text primary key,
  project_id        bigint not null references projects(id) on delete cascade,
  project_seq       bigint not null,
  scope             text not null,
  type              text not null,
  topic_key         text,
  title             text not null,
  content           text,
  tags              jsonb,
  content_hash      text,
  origin_ai         text,
  origin_account    text,
  git_branch        text,
  author_id         uuid not null references users(id),
  author_display    text,
  lamport           bigint not null,
  client_updated_at timestamptz not null,
  client_created_at timestamptz not null,
  server_created_at timestamptz not null default now(),
  deleted           boolean not null default false,
  superseded_by     text,
  unique (project_id, project_seq)
);

create unique index if not exists obs_topic_uniq on observations (project_id, scope, topic_key)
  where topic_key is not null and superseded_by is null and deleted = false;

create index if not exists obs_pull on observations (project_id, project_seq);

create table if not exists push_receipts (
  device_id  uuid not null references devices(id) on delete cascade,
  seq        bigint not null,
  sync_id    text not null,
  outcome    text not null,
  project_seq bigint,
  created_at timestamptz not null default now(),
  primary key (device_id, seq)
);

create table if not exists allowlist (
  user_id    uuid primary key references users(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);
