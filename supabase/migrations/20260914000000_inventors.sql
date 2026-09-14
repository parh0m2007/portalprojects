-- ============================================================
-- КейсПортал — Модуль «Союз изобретателей»: витрина изобретений
-- и мэтчинг с инвесторами (izobretu.com: Инвесторы, Изобретателям)
--   1) investor_profiles: каталог инвесторов с модерацией
--   2) inventions: витрина изобретений с контролем видимости
--      (public / investors_only / private) — защита патентной новизны
--   3) contact_requests: заявки инвесторов на контакт
--   4) recommended_investors(): матчинг по секторам + эмбеддингам
-- Запустить в SQL Editor (после schema.sql и embeddings.sql). Идемпотентно.
-- ============================================================

-- ---------- Профили инвесторов ----------
create table if not exists public.investor_profiles (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  kind       text not null default 'angel'
    check (kind in ('angel', 'fund', 'corporate', 'government')),
  name       text not null default '',
  thesis     text not null default '',
  sectors    text[] not null default array[]::text[],
  ticket_min numeric check (ticket_min is null or ticket_min >= 0),
  ticket_max numeric check (ticket_max is null or ticket_max >= 0),
  website    text not null default '',
  status     text not null default 'pending' check (status in ('pending', 'approved', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- для матчинга с изобретениями (эмбеддинг thesis, BGE-M3 1024)
  embedding  extensions.vector(1024)
);

create index if not exists investor_profiles_status_idx on public.investor_profiles(status);
create index if not exists investor_profiles_embedding_idx on public.investor_profiles
  using ivfflat (embedding extensions.vector_cosine_ops) with (lists = 100);

-- ---------- Изобретения ----------
create table if not exists public.inventions (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null references public.profiles(id) on delete cascade,
  title       text not null,
  summary     text not null default '',
  description text not null default '',
  -- стадия готовности: идея → прототип → MVP → патент → рынок
  stage       text not null default 'idea'
    check (stage in ('idea', 'prototype', 'mvp', 'patent_pending', 'patented', 'market')),
  patent_status text not null default '',
  sectors     text[] not null default array[]::text[],
  funding_goal numeric check (funding_goal is null or funding_goal >= 0),
  pitch_path  text,
  -- событие-источник: изобретение родилось из конкурса на портале
  event_id    uuid references public.events(id) on delete set null,
  -- контроль раскрытия: публичное раскрытие до патентной заявки
  -- уничтожает новизну, поэтому по умолчанию — только инвесторы
  visibility  text not null default 'investors_only'
    check (visibility in ('public', 'investors_only', 'private')),
  status      text not null default 'draft' check (status in ('draft', 'published')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  embedding   extensions.vector(1024)
);

create index if not exists inventions_author_idx  on public.inventions(author_id);
create index if not exists inventions_status_idx   on public.inventions(status);
create index if not exists inventions_embedding_idx on public.inventions
  using ivfflat (embedding extensions.vector_cosine_ops) with (lists = 100);

-- ---------- Заявки инвесторов на контакт ----------
create table if not exists public.contact_requests (
  id           uuid primary key default gen_random_uuid(),
  invention_id uuid not null references public.inventions(id) on delete cascade,
  investor_id  uuid not null references public.profiles(id) on delete cascade,
  message      text not null default '',
  status       text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'withdrawn')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (invention_id, investor_id)
);

create index if not exists contact_requests_invention_idx on public.contact_requests(invention_id);
create index if not exists contact_requests_investor_idx  on public.contact_requests(investor_id);

alter table public.investor_profiles enable row level security;
alter table public.inventions       enable row level security;
alter table public.contact_requests enable row level security;

-- ---------- Хелперы ----------
-- Пользователь — одобренный инвестор
create or replace function public.is_approved_investor(uid uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.investor_profiles
    where user_id = uid and status = 'approved'
  );
$$;

-- Изобретение видно пользователю с учётом visibility
create or replace function public.invention_visible(inv public.inventions)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    inv.author_id = auth.uid()
    or inv.status = 'draft' and false  -- черновики не видны никому кроме автора
    or (
      inv.status = 'published'
      and (
        inv.visibility = 'public'
        or (inv.visibility = 'investors_only' and public.is_approved_investor())
      )
    );
$$;

grant execute on function public.is_approved_investor(uuid) to authenticated;

-- ---------- RLS: инвесторы ----------
drop policy if exists "investors: публичный каталог" on public.investor_profiles;
create policy "investors: публичный каталог"
  on public.investor_profiles for select
  using (status = 'approved' or user_id = auth.uid());

drop policy if exists "investors: создаёт себе" on public.investor_profiles;
create policy "investors: создаёт себе"
  on public.investor_profiles for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "investors: редактирует своё" on public.investor_profiles;
create policy "investors: редактирует своё"
  on public.investor_profiles for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------- RLS: изобретения ----------
drop policy if exists "inventions: видимость" on public.inventions;
create policy "inventions: видимость"
  on public.inventions for select
  using (public.invention_visible(inventions));

drop policy if exists "inventions: создаёт автор" on public.inventions;
create policy "inventions: создаёт автор"
  on public.inventions for insert to authenticated
  with check (author_id = auth.uid());

drop policy if exists "inventions: управляет автор" on public.inventions;
create policy "inventions: управляет автор"
  on public.inventions for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

drop policy if exists "inventions: удаляет автор" on public.inventions;
create policy "inventions: удаляет автор"
  on public.inventions for delete to authenticated
  using (author_id = auth.uid());

-- ---------- RLS: заявки на контакт ----------
drop policy if exists "contact_requests: видят стороны" on public.contact_requests;
create policy "contact_requests: видят стороны"
  on public.contact_requests for select to authenticated
  using (
    investor_id = auth.uid()
    or exists (
      select 1 from public.inventions i
      where i.id = invention_id and i.author_id = auth.uid()
    )
  );

-- Заявку подаёт одобренный инвестор от своего имени
drop policy if exists "contact_requests: подаёт инвестор" on public.contact_requests;
create policy "contact_requests: подаёт инвестор"
  on public.contact_requests for insert to authenticated
  with check (
    investor_id = auth.uid() and public.is_approved_investor(auth.uid())
  );

-- Инвестор меняет только свою заявку; автор — только отклоняет
drop policy if exists "contact_requests: обновляют стороны" on public.contact_requests;
create policy "contact_requests: обновляют стороны"
  on public.contact_requests for update to authenticated
  using (
    investor_id = auth.uid()
    or exists (
      select 1 from public.inventions i
      where i.id = invention_id and i.author_id = auth.uid()
    )
  )
  with check (investor_id = auth.uid());

drop policy if exists "contact_requests: удаляет инвестор" on public.contact_requests;
create policy "contact_requests: удаляет инвестор"
  on public.contact_requests for delete to authenticated
  using (investor_id = auth.uid());

-- ---------- Публичная витрина (для карточек) ----------
create or replace view public.invention_cards with (security_invoker = true) as
select
  i.id,
  i.author_id,
  i.title,
  i.summary,
  i.description,
  i.stage,
  i.patent_status,
  i.sectors,
  i.funding_goal,
  i.pitch_path,
  i.event_id,
  i.visibility,
  i.status,
  i.created_at,
  p.full_name as author_name,
  e.title as event_title,
  (select count(*)::int from public.contact_requests cr
    where cr.invention_id = i.id and cr.status = 'accepted') as contacts_count
from public.inventions i
join public.profiles p on p.id = i.author_id
left join public.events e on e.id = i.event_id;

-- ---------- Матчинг: рекомендуемые инвесторы для изобретения ----------
-- Скоринг: пересечение секторов (совпадение строки) × 2
--         + косинусная близость эмбеддингов (BGE-M3), если есть
create or replace function public.recommended_investors(
  inv uuid,
  limit_count int default 5
)
returns table (
  user_id uuid,
  name text,
  kind text,
  thesis text,
  sectors text[],
  ticket_min numeric,
  ticket_max numeric,
  website text,
  score numeric
)
language sql stable security definer set search_path = public, extensions
as $$
  with target as (
    select embedding, sectors from public.inventions where id = inv
  )
  select
    ip.user_id,
    ip.name,
    ip.kind,
    ip.thesis,
    ip.sectors,
    ip.ticket_min,
    ip.ticket_max,
    ip.website,
    round(
      (
        2.0 * (
          select count(*) from (
            select unnest(ip.sectors) intersect
            select unnest(t.sectors)
          ) shared
        )
        + case
            when ip.embedding is not null and t.embedding is not null
              then 4.0 * (1 - (ip.embedding <=> t.embedding))
            else 0
          end
      )::numeric,
      2
    ) as score
  from public.investor_profiles ip
  cross join target t
  where ip.status = 'approved'
  order by score desc, ip.created_at
  limit least(greatest(limit_count, 1), 20);
$$;

grant execute on function public.recommended_investors(uuid, int) to authenticated;

-- ---------- Уведомления ----------
-- Новая заявка на контакт → автору изобретения
create or replace function public.fn_notify_contact_request()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_author uuid;
  v_title  text;
begin
  select author_id, title into v_author, v_title
  from public.inventions where id = new.invention_id;
  insert into public.notifications (user_id, type, title, body, link)
  values (
    v_author, 'contact',
    'Заявка на контакт по изобретению',
    v_title,
    '/inventions/' || new.invention_id::text
  );
  return new;
end;
$$;

drop trigger if exists trg_notify_contact_request on public.contact_requests;
create trigger trg_notify_contact_request
  after insert on public.contact_requests
  for each row execute function public.fn_notify_contact_request();

-- Статус заявки → инвестору
create or replace function public.fn_notify_contact_status()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status is distinct from old.status and new.status <> 'pending' then
    insert into public.notifications (user_id, type, title, body, link)
    values (
      new.investor_id, 'contact',
      case new.status
        when 'accepted'  then 'Автор принял заявку на контакт'
        when 'declined'  then 'Автор отклонил заявку на контакт'
        else 'Заявка на контакт отозвана'
      end,
      '',
      '/inventions/' || new.invention_id::text
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_contact_status on public.contact_requests;
create trigger trg_notify_contact_status
  after update on public.contact_requests
  for each row execute function public.fn_notify_contact_status();

-- ---------- Webhook: contact_request.created ----------
create or replace function public.fn_webhook_contact_request()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform public.fn_deliver_webhooks(
    'contact_request.created',
    jsonb_build_object(
      'contact_request_id', new.id,
      'invention_id', new.invention_id,
      'investor_id', new.investor_id,
      'status', new.status,
      'created_at', new.created_at
    )
  );
  return new;
end;
$$;

drop trigger if exists trg_webhook_contact_request on public.contact_requests;
create trigger trg_webhook_contact_request
  after insert on public.contact_requests
  for each row execute function public.fn_webhook_contact_request();

-- ---------- Storage: приватный bucket питч-деков ----------
-- Публичное раскрытие деков недопустимо до патентования: доступ —
-- только по подписанной ссылке с карточки изобретения.
insert into storage.buckets (id, name, public)
values ('inventions', 'inventions', false)
on conflict (id) do nothing;

drop policy if exists "inventions: автор читает свои" on storage.objects;
create policy "inventions: автор читает свои"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'inventions'
    and exists (
      select 1 from public.inventions i
      where i.pitch_path = objects.name and i.author_id = auth.uid()
    )
  );
-- Одобренный инвестор с заявкой на контакт (принятой или на рассмотрении)
drop policy if exists "inventions: инвестор по заявке" on storage.objects;
create policy "inventions: инвестор по заявке"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'inventions'
    and exists (
      select 1
      from public.contact_requests cr
      join public.inventions i on i.id = cr.invention_id
      where i.pitch_path = objects.name
        and cr.investor_id = auth.uid()
        and cr.status in ('pending', 'accepted')
    )
  );
drop policy if exists "inventions: загружает автор" on storage.objects;
create policy "inventions: загружает автор"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'inventions'
    and exists (
      select 1 from public.inventions i
      where i.pitch_path = objects.name and i.author_id = auth.uid()
    )
  );
