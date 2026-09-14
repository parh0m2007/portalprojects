-- ============================================================
-- КейсПортал — Модуль «Союз изобретателей»: наставничество
-- (izobretu.com: программа «Наставники»)
--   1) mentor_profiles: профили наставников с модерацией
--   2) mentorship_requests: заявки менти
--   3) mentorship_relations: активные связи + лимит capacity
--   4) mentorship_notes: журнал сессий
-- Запустить в SQL Editor (после inventors.sql). Идемпотентно.
-- ============================================================

-- ---------- Профили наставников ----------
create table if not exists public.mentor_profiles (
  user_id         uuid primary key references public.profiles(id) on delete cascade,
  title           text not null default '',
  bio             text not null default '',
  expertise       text[] not null default array[]::text[],
  experience_years int check (experience_years is null or experience_years >= 0),
  capacity        int not null default 3 check (capacity > 0),
  format          text not null default 'online' check (format in ('online', 'offline')),
  city            text not null default '',
  status          text not null default 'pending' check (status in ('pending', 'approved', 'blocked')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists mentor_profiles_status_idx on public.mentor_profiles(status);

-- ---------- Заявки на наставничество ----------
create table if not exists public.mentorship_requests (
  id           uuid primary key default gen_random_uuid(),
  mentor_id    uuid not null references public.profiles(id) on delete cascade,
  mentee_id    uuid not null references public.profiles(id) on delete cascade,
  -- контекст необязателен: можно просить наставничество по конкретному изобретению
  invention_id uuid references public.inventions(id) on delete set null,
  topic        text not null default '',
  message      text not null default '',
  status       text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at   timestamptz not null default now(),
  unique (mentor_id, mentee_id, invention_id)
);

create index if not exists mentorship_requests_mentor_idx on public.mentorship_requests(mentor_id);
create index if not exists mentorship_requests_mentee_idx on public.mentorship_requests(mentee_id);

-- ---------- Активные связи ----------
create table if not exists public.mentorship_relations (
  id           uuid primary key default gen_random_uuid(),
  mentor_id    uuid not null references public.profiles(id) on delete cascade,
  mentee_id    uuid not null references public.profiles(id) on delete cascade,
  invention_id uuid references public.inventions(id) on delete set null,
  goals        text not null default '',
  status       text not null default 'active' check (status in ('active', 'closed')),
  started_at   timestamptz not null default now(),
  closed_at    timestamptz,
  unique (mentor_id, mentee_id, invention_id)
);

create index if not exists mentorship_relations_mentor_idx on public.mentorship_relations(mentor_id);
create index if not exists mentorship_relations_mentee_idx on public.mentorship_relations(mentee_id);

-- ---------- Журнал сессий ----------
create table if not exists public.mentorship_notes (
  id           uuid primary key default gen_random_uuid(),
  relation_id  uuid not null references public.mentorship_relations(id) on delete cascade,
  author_id    uuid not null references public.profiles(id) on delete cascade,
  content      text not null,
  next_steps   text not null default '',
  created_at   timestamptz not null default now()
);

create index if not exists mentorship_notes_relation_idx on public.mentorship_notes(relation_id);

alter table public.mentor_profiles        enable row level security;
alter table public.mentorship_requests    enable row level security;
alter table public.mentorship_relations   enable row level security;
alter table public.mentorship_notes       enable row level security;

-- ---------- Хелперы ----------
-- Пользователь — одобренный наставник
create or replace function public.is_approved_mentor(uid uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.mentor_profiles
    where user_id = uid and status = 'approved'
  );
$$;

grant execute on function public.is_approved_mentor(uuid) to authenticated;

-- ---------- RLS: наставники ----------
drop policy if exists "mentors: публичный каталог" on public.mentor_profiles;
create policy "mentors: публичный каталог"
  on public.mentor_profiles for select
  using (status = 'approved' or user_id = auth.uid());

drop policy if exists "mentors: создаёт себе" on public.mentor_profiles;
create policy "mentors: создаёт себе"
  on public.mentor_profiles for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "mentors: редактирует своё" on public.mentor_profiles;
create policy "mentors: редактирует своё"
  on public.mentor_profiles for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------- RLS: заявки ----------
drop policy if exists "mentorship_requests: видит пара" on public.mentorship_requests;
create policy "mentorship_requests: видит пара"
  on public.mentorship_requests for select to authenticated
  using (mentor_id = auth.uid() or mentee_id = auth.uid());

-- Подать заявку может любой авторизованный от своего имени
drop policy if exists "mentorship_requests: подаёт менти" on public.mentorship_requests;
create policy "mentorship_requests: подаёт менти"
  on public.mentorship_requests for insert to authenticated
  with check (
    mentee_id = auth.uid() and mentor_id <> auth.uid()
    and public.is_approved_mentor(mentor_id)
  );

-- Статус меняет только наставник; менти может удалить свою заявку
drop policy if exists "mentorship_requests: обновляет наставник" on public.mentorship_requests;
create policy "mentorship_requests: обновляет наставник"
  on public.mentorship_requests for update to authenticated
  using (mentor_id = auth.uid())
  with check (mentor_id = auth.uid());

drop policy if exists "mentorship_requests: удаляет менти" on public.mentorship_requests;
create policy "mentorship_requests: удаляет менти"
  on public.mentorship_requests for delete to authenticated
  using (mentee_id = auth.uid());

-- ---------- RLS: связи ----------
drop policy if exists "mentorship_relations: видит пара" on public.mentorship_relations;
create policy "mentorship_relations: видит пара"
  on public.mentorship_relations for select to authenticated
  using (mentor_id = auth.uid() or mentee_id = auth.uid());

drop policy if exists "mentorship_relations: создаёт наставник" on public.mentorship_relations;
create policy "mentorship_relations: создаёт наставник"
  on public.mentorship_relations for insert to authenticated
  with check (mentor_id = auth.uid());

-- Закрывает связь любой из пары
drop policy if exists "mentorship_relations: ведёт пара" on public.mentorship_relations;
create policy "mentorship_relations: ведёт пара"
  on public.mentorship_relations for update to authenticated
  using (mentor_id = auth.uid() or mentee_id = auth.uid());

-- ---------- RLS: журнал ----------
drop policy if exists "mentorship_notes: видит пара" on public.mentorship_notes;
create policy "mentorship_notes: видит пара"
  on public.mentorship_notes for select to authenticated
  using (
    exists (
      select 1 from public.mentorship_relations r
      where r.id = relation_id
        and (r.mentor_id = auth.uid() or r.mentee_id = auth.uid())
    )
  );

drop policy if exists "mentorship_notes: пишет пара" on public.mentorship_notes;
create policy "mentorship_notes: пишет пара"
  on public.mentorship_notes for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.mentorship_relations r
      where r.id = relation_id
        and r.status = 'active'
        and (r.mentor_id = auth.uid() or r.mentee_id = auth.uid())
    )
  );

-- ---------- Capacity: не больше N активных менти у наставника ----------
-- При accept заявки автоматически создаём связь; триггер проверяет лимит.
create or replace function public.fn_mentorship_accept()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_capacity int;
  v_active int;
begin
  if new.status = 'accepted' and old.status <> 'accepted' then
    select coalesce(capacity, 3) into v_capacity
    from public.mentor_profiles where user_id = new.mentor_id;
    select count(*) into v_active
    from public.mentorship_relations
    where mentor_id = new.mentor_id and status = 'active';

    if v_active >= v_capacity then
      raise exception 'Наставник не может принять заявку: лимит активных менти исчерпан (capacity=%)', v_capacity;
    end if;

    insert into public.mentorship_relations (mentor_id, mentee_id, invention_id, goals)
    values (new.mentor_id, new.mentee_id, new.invention_id, new.topic)
    on conflict (mentor_id, mentee_id, invention_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_mentorship_accept on public.mentorship_requests;
create trigger trg_mentorship_accept
  before update on public.mentorship_requests
  for each row execute function public.fn_mentorship_accept();

-- ---------- Уведомления ----------
-- Новая заявка → наставнику
create or replace function public.fn_notify_mentorship_request()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, title, body, link)
  values (
    new.mentor_id, 'mentorship',
    'Новая заявка на наставничество',
    new.topic,
    '/mentorship'
  );
  return new;
end;
$$;

drop trigger if exists trg_notify_mentorship_request on public.mentorship_requests;
create trigger trg_notify_mentorship_request
  after insert on public.mentorship_requests
  for each row execute function public.fn_notify_mentorship_request();

-- Ответ наставника → менти
create or replace function public.fn_notify_mentorship_status()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status is distinct from old.status and new.status in ('accepted', 'declined') then
    insert into public.notifications (user_id, type, title, body, link)
    values (
      new.mentee_id, 'mentorship',
      case new.status
        when 'accepted' then 'Наставник принял заявку'
        else 'Наставник отклонил заявку'
      end,
      new.topic,
      '/mentorship'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_mentorship_status on public.mentorship_requests;
create trigger trg_notify_mentorship_status
  after update on public.mentorship_requests
  for each row execute function public.fn_notify_mentorship_status();
