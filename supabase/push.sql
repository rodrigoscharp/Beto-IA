-- Push notifications do Beto (rode uma vez no SQL Editor do Supabase).
-- Como a jarvis_memories, ficam sem RLS: só o servidor usa a anon key.

create table if not exists push_subscriptions (
  endpoint   text primary key,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz default now()
);

-- Ids de avisos já enviados por push (dedupe entre execuções do cron).
create table if not exists push_seen (
  id         text primary key,
  created_at timestamptz default now()
);

-- Segredos do servidor (ex.: refresh token do Google, sempre CIFRADO com TOKEN_ENC_KEY antes de gravar).
create table if not exists push_secrets (
  name       text primary key,
  value      text not null,
  updated_at timestamptz default now()
);
