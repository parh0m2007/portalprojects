-- ============================================================
-- КейсПортал — миграция: состав команд, лимит мест и лист
-- ожидания, публичные организаторы, подписки.
-- Запустить в SQL Editor. Идемпотентно.
-- ============================================================

-- ---------- Состав команды ----------
create table if not exists public.team_members (
  team_id   uuid not null references public.teams(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

alter table public.team_members enable row level security;

drop policy if exists "team_members: читать авторизованным" on public.team_members;
create policy "team_members: читать авторизованным"
  on public.team_members for select to authenticated using (true);
drop policy if exists "team_members: вступить самому" on public.team_members;
create policy "team_members: вступить самому"
  on public.team_members for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists "team_members: выйти или капитан удаляет" on public.team_members;
create policy "team_members: выйти или капитан удаляет"
  on public.team_members for delete to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.teams t
      where t.id = team_members.team_id and t.captain_id = auth.uid()
    )
  );

-- Код приглашения в команду
alter table public.teams add column if not exists invite_code text;

update public.teams
set invite_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
where invite_code is null;

alter table public.teams drop constraint if exists teams_invite_code_key;
alter table public.teams add constraint teams_invite_code_key unique (invite_code);

-- ---------- Лимит мест и лист ожидания ----------
alter table public.events add column if not exists capacity int;

alter table public.registrations drop constraint if exists registrations_status_check;
alter table public.registrations add constraint registrations_status_check
  check (status in ('pending', 'approved', 'rejected', 'waitlist'));

-- ---------- Публичный профиль организатора ----------
alter table public.profiles add column if not exists bio text not null default '';

-- Публичное представление (без email)
create or replace view public.organizers as
select id, full_name, bio from public.profiles;

-- ---------- Подписки на организаторов ----------
create table if not exists public.follows (
  follower_id  uuid not null references public.profiles(id) on delete cascade,
  organizer_id uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, organizer_id)
);

alter table public.follows enable row level security;

drop policy if exists "follows: управлять своими" on public.follows;
create policy "follows: управлять своими"
  on public.follows for all to authenticated
  using (follower_id = auth.uid())
  with check (follower_id = auth.uid());

-- Публичные счётчики подписчиков (без раскрытия кто именно)
create or replace view public.organizer_stats as
select
  p.id as organizer_id,
  (select count(*) from public.follows f where f.organizer_id = p.id) as followers_count,
  (select count(*) from public.events e where e.author_id = p.id and e.status = 'published') as events_count
from public.profiles p;

-- ---------- event_stats v2: одобренные, лимит, свободные места ----------
create or replace view public.event_stats as
select
  e.id as event_id,
  (select count(*) from public.registrations r where r.event_id = e.id) as participants_count,
  (select count(*) from public.registrations r where r.event_id = e.id and r.status = 'approved') as approved_count,
  (select count(*) from public.registrations r where r.event_id = e.id and r.status = 'waitlist') as waitlist_count,
  e.capacity,
  case
    when e.capacity is null then null
    else greatest(e.capacity - (select count(*) from public.registrations r where r.event_id = e.id and r.status = 'approved'), 0)
  end as seats_left,
  (
    select count(*)
    from public.solutions s
    join public.registrations r2 on r2.id = s.registration_id
    where r2.event_id = e.id
  ) as solutions_count
from public.events e;

-- ---------- Уведомление подписчикам о новом событии ----------
create or replace function public.fn_notify_followers_new_event()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, title, body, link)
  select
    f.follower_id,
    'info',
    'Новое событие от ' || coalesce(p.full_name, 'организатора'),
    new.title,
    '/events/' || new.id::text
  from public.follows f
  join public.profiles p on p.id = new.author_id
  where f.organizer_id = new.author_id and f.follower_id <> new.author_id;
  return new;
end;
$$;

drop trigger if exists trg_notify_followers on public.events;
create trigger trg_notify_followers
  after insert on public.events
  for each row execute function public.fn_notify_followers_new_event();
