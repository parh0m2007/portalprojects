-- ============================================================
-- КейсПортал — Публичный REST API: ключи и webhooks
--  1) api_keys: ключи организаций/авторов для /api/v1
--  2) api_webhooks: подписки на события (registration.created, ...)
--  3) webhook_deliveries: журнал доставки + фоновая доставка pg_net
-- Запустить в SQL Editor (после migration_organizations.sql). Идемпотентно.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_net with schema extensions;

-- ---------- API-ключи ----------
create table if not exists public.api_keys (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid references public.organizations(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete cascade,
  name        text not null default 'default',
  key_hash    text not null unique,          -- sha256(ключ); сам ключ не храним
  key_prefix  text not null,                 -- первые символы для отображения
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  check (org_id is not null or user_id is not null)
);

create index if not exists api_keys_hash_idx on public.api_keys(key_hash);

alter table public.api_keys enable row level security;

-- Ключами управляют: владелец ключа (личные) или owner/admin организации
drop policy if exists "api_keys: видеть свои / организации" on public.api_keys;
create policy "api_keys: видеть свои / организации"
  on public.api_keys for select to authenticated
  using (
    user_id = auth.uid()
    or (org_id is not null and public.is_org_manager(org_id))
  );
drop policy if exists "api_keys: создаёт владелец/организация" on public.api_keys;
create policy "api_keys: создаёт владелец/организация"
  on public.api_keys for insert to authenticated
  with check (
    (user_id = auth.uid() and org_id is null)
    or (org_id is not null and public.is_org_manager(org_id))
  );
drop policy if exists "api_keys: отзывает владелец/организация" on public.api_keys;
create policy "api_keys: отзывает владелец/организация"
  on public.api_keys for update to authenticated
  using (
    user_id = auth.uid()
    or (org_id is not null and public.is_org_manager(org_id))
  );

-- RPC: создать ключ (возвращает открытый ключ ОДИН раз)
create or replace function public.create_api_key(
  key_name text default 'default',
  org uuid default null
)
returns text
language plpgsql security definer set search_path = public, extensions
as $$
declare
  raw_key  text;
  key_hash text;
  key_prefix text;
begin
  if org is not null and not public.is_org_manager(org) then
    raise exception 'Создавать ключи организации может owner/admin';
  end if;
  if org is null and auth.uid() is null then
    raise exception 'Нет пользователя';
  end if;

  raw_key := 'cp_' || encode(gen_random_bytes(24), 'hex');
  key_hash := encode(digest(raw_key, 'sha256'), 'hex');
  key_prefix := left(raw_key, 11);

  insert into public.api_keys (org_id, user_id, name, key_hash, key_prefix)
  values (org, auth.uid(), coalesce(key_name, 'default'), key_hash, key_prefix);

  return raw_key;
end;
$$;
grant execute on function public.create_api_key(text, uuid) to authenticated;

-- Проверка ключа для REST API (вызывается сервером Next.js через service role)
create or replace function public.verify_api_key(raw_key text)
returns table (
  valid boolean,
  api_key_id uuid,
  org_id uuid,
  user_id uuid
)
language sql stable security definer set search_path = public
as $$
  select
    true,
    k.id,
    k.org_id,
    k.user_id
  from public.api_keys k
  where k.key_hash = encode(extensions.digest(raw_key, 'sha256'), 'hex')
    and k.revoked_at is null
  limit 1;
$$;
-- НЕ grant authenticated: вызывается только сервисной ролью.

-- ---------- Webhooks ----------
create table if not exists public.api_webhooks (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid references public.organizations(id) on delete cascade,
  url        text not null,
  secret     text not null default encode(gen_random_bytes(16), 'hex'),
  events     text[] not null default array['registration.created'],
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.webhook_deliveries (
  id          uuid primary key default gen_random_uuid(),
  webhook_id  uuid not null references public.api_webhooks(id) on delete cascade,
  event_type  text not null,
  payload     jsonb not null,
  status_code int,
  delivered_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists webhook_deliveries_webhook_idx
  on public.webhook_deliveries(webhook_id, created_at desc);

alter table public.api_webhooks       enable row level security;
alter table public.webhook_deliveries enable row level security;

drop policy if exists "webhooks: управляет организация" on public.api_webhooks;
create policy "webhooks: управляет организация"
  on public.api_webhooks for all to authenticated
  using (public.is_org_manager(org_id))
  with check (public.is_org_manager(org_id));

drop policy if exists "webhooks: журнал видит организация" on public.webhook_deliveries;
create policy "webhooks: журнал видит организация"
  on public.webhook_deliveries for select to authenticated
  using (
    exists (
      select 1 from public.api_webhooks w
      where w.id = webhook_deliveries.webhook_id
        and public.is_org_manager(w.org_id)
    )
  );

-- ---------- Доставка webhook (pg_net) ----------
create or replace function public.fn_deliver_webhooks(
  p_event_type text,
  p_payload jsonb
)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  wh record;
begin
  for wh in
    select * from public.api_webhooks
    where is_active and p_event_type = any(events)
  loop
    insert into public.webhook_deliveries (webhook_id, event_type, payload)
    values (wh.id, p_event_type, p_payload);

    perform net.http_post(
      url := wh.url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-CasePortal-Event', p_event_type,
        'X-CasePortal-Signature', 'sha256=' || encode(
          hmac(p_payload::text, wh.secret, 'sha256'), 'hex'
        )
      ),
      body := p_payload::text
    );
  end loop;
end;
$$;

-- ---------- Триггеры событий ----------
-- registration.created / registration.status_changed
create or replace function public.fn_webhook_registration_created()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform public.fn_deliver_webhooks(
    'registration.created',
    jsonb_build_object(
      'registration_id', new.id,
      'event_id', new.event_id,
      'status', new.status,
      'created_at', new.created_at
    )
  );
  return new;
end;
$$;

drop trigger if exists trg_webhook_registration_created on public.registrations;
create trigger trg_webhook_registration_created
  after insert on public.registrations
  for each row execute function public.fn_webhook_registration_created();

create or replace function public.fn_webhook_registration_status()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    perform public.fn_deliver_webhooks(
      'registration.status_changed',
      jsonb_build_object(
        'registration_id', new.id,
        'event_id', new.event_id,
        'old_status', old.status,
        'new_status', new.status
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_webhook_registration_status on public.registrations;
create trigger trg_webhook_registration_status
  after update on public.registrations
  for each row execute function public.fn_webhook_registration_status();

-- solution.uploaded
create or replace function public.fn_webhook_solution_uploaded()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_event_id uuid;
begin
  select r.event_id into v_event_id from public.registrations r
  where r.id = new.registration_id;
  perform public.fn_deliver_webhooks(
    'solution.uploaded',
    jsonb_build_object(
      'solution_id', new.id,
      'event_id', v_event_id,
      'title', new.title,
      'created_at', new.created_at
    )
  );
  return new;
end;
$$;

drop trigger if exists trg_webhook_solution_uploaded on public.solutions;
create trigger trg_webhook_solution_uploaded
  after insert on public.solutions
  for each row execute function public.fn_webhook_solution_uploaded();

-- results.published
create or replace function public.fn_webhook_results_published()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.results_published_at is not null
     and old.results_published_at is null then
    perform public.fn_deliver_webhooks(
      'results.published',
      jsonb_build_object('event_id', new.id, 'published_at', new.results_published_at)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_webhook_results_published on public.events;
create trigger trg_webhook_results_published
  after update on public.events
  for each row execute function public.fn_webhook_results_published();
