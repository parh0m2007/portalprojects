-- ============================================================
-- КейсПортал — схема БД для Supabase
-- Скрипт идемпотентный: можно запускать повторно.
-- Выполнить целиком в SQL Editor проекта Supabase.
-- ============================================================

-- ---------- Профили ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null default '',
  email      text not null default '',
  created_at timestamptz not null default now()
);

-- ---------- Мероприятия ----------
create table if not exists public.events (
  id                    uuid primary key default gen_random_uuid(),
  author_id             uuid not null references public.profiles(id) on delete cascade,
  title                 text not null,
  description           text not null default '',
  format                text not null default 'case' check (format in ('case', 'lecture')),
  place                 text not null default '',
  starts_at             timestamptz,
  registration_deadline timestamptz,
  status                text not null default 'published' check (status in ('draft', 'published', 'finished')),
  cover_path            text,
  results_published_at  timestamptz,
  created_at            timestamptz not null default now()
);

-- ---------- Кейсы мероприятия ----------
create table if not exists public.cases (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  title       text not null,
  description text not null default '',
  created_at  timestamptz not null default now()
);

-- ---------- Команды ----------
create table if not exists public.teams (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  captain_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- Регистрации (заявки) ----------
create table if not exists public.registrations (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  team_id     uuid references public.teams(id) on delete set null,
  case_id     uuid references public.cases(id) on delete set null,
  contact     text not null default '',
  comment     text not null default '',
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz not null default now(),
  unique (event_id, user_id)
);

-- ---------- Решения команд ----------
create table if not exists public.solutions (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations(id) on delete cascade,
  title           text not null,
  description     text not null default '',
  file_path       text,
  status          text not null default 'submitted' check (status in ('submitted', 'graded')),
  created_at      timestamptz not null default now()
);

-- ---------- Судьи мероприятия ----------
create table if not exists public.event_judges (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  invited_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (event_id, user_id)
);

-- ---------- Критерии оценки ----------
create table if not exists public.criteria (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  title      text not null,
  max_score  int  not null default 10 check (max_score > 0),
  sort_order int  not null default 0
);

-- ---------- Оценки судей ----------
create table if not exists public.scores (
  id           uuid primary key default gen_random_uuid(),
  solution_id  uuid not null references public.solutions(id) on delete cascade,
  judge_id     uuid not null references public.profiles(id) on delete cascade,
  criterion_id uuid not null references public.criteria(id) on delete cascade,
  score        int  not null check (score >= 0),
  comment      text not null default '',
  created_at   timestamptz not null default now(),
  unique (solution_id, judge_id, criterion_id)
);

-- ---------- Индексы ----------
create index if not exists events_author_idx      on public.events(author_id);
create index if not exists cases_event_idx        on public.cases(event_id);
create index if not exists registrations_event_idx on public.registrations(event_id);
create index if not exists registrations_user_idx on public.registrations(user_id);
create index if not exists solutions_reg_idx      on public.solutions(registration_id);
create index if not exists criteria_event_idx     on public.criteria(event_id);
create index if not exists scores_solution_idx    on public.scores(solution_id);
create index if not exists judges_user_idx        on public.event_judges(user_id);

-- ============================================================
-- Триггер: автоматическое создание профиля при регистрации
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.email, '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- Хелперы для RLS
-- ============================================================
create or replace function public.is_event_author(ev uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.events
    where id = ev and author_id = auth.uid()
  );
$$;

-- Судья события = принятый судья ИЛИ автор мероприятия
-- (у автора изначально есть права судьи)
create or replace function public.is_event_judge(ev uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.event_judges
    where event_id = ev and user_id = auth.uid() and status = 'accepted'
  ) or public.is_event_author(ev);
$$;

-- ============================================================
-- RLS
-- ============================================================
alter table public.profiles      enable row level security;
alter table public.events        enable row level security;
alter table public.cases         enable row level security;
alter table public.teams         enable row level security;
alter table public.registrations enable row level security;
alter table public.solutions     enable row level security;
alter table public.event_judges  enable row level security;
alter table public.criteria      enable row level security;
alter table public.scores        enable row level security;

-- profiles
drop policy if exists "profiles: читать авторизованным" on public.profiles;
create policy "profiles: читать авторизованным"
  on public.profiles for select to authenticated using (true);
drop policy if exists "profiles: создать свой" on public.profiles;
create policy "profiles: создать свой"
  on public.profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists "profiles: обновить свой" on public.profiles;
create policy "profiles: обновить свой"
  on public.profiles for update to authenticated using (id = auth.uid());

-- events: опубликованные видят все (включая анонимных), свои — автор
drop policy if exists "events: опубликованные публичны" on public.events;
create policy "events: опубликованные публичны"
  on public.events for select
  using (status = 'published' or author_id = auth.uid());
drop policy if exists "events: автор создаёт" on public.events;
create policy "events: автор создаёт"
  on public.events for insert to authenticated with check (author_id = auth.uid());
drop policy if exists "events: автор изменяет" on public.events;
create policy "events: автор изменяет"
  on public.events for update to authenticated using (author_id = auth.uid());
drop policy if exists "events: автор удаляет" on public.events;
create policy "events: автор удаляет"
  on public.events for delete to authenticated using (author_id = auth.uid());

-- cases: видимость следует за мероприятием
drop policy if exists "cases: публично по событию" on public.cases;
create policy "cases: публично по событию"
  on public.cases for select
  using (
    exists (
      select 1 from public.events e
      where e.id = event_id and (e.status = 'published' or e.author_id = auth.uid())
    )
  );
drop policy if exists "cases: управляет автор" on public.cases;
create policy "cases: управляет автор"
  on public.cases for all to authenticated
  using (public.is_event_author(event_id))
  with check (public.is_event_author(event_id));

-- criteria: аналогично cases
drop policy if exists "criteria: публично по событию" on public.criteria;
create policy "criteria: публично по событию"
  on public.criteria for select
  using (
    exists (
      select 1 from public.events e
      where e.id = event_id and (e.status = 'published' or e.author_id = auth.uid())
    )
  );
drop policy if exists "criteria: управляет автор" on public.criteria;
create policy "criteria: управляет автор"
  on public.criteria for all to authenticated
  using (public.is_event_author(event_id))
  with check (public.is_event_author(event_id));

-- teams: читают авторизованные, создаёт капитан
drop policy if exists "teams: читать авторизованным" on public.teams;
create policy "teams: читать авторизованным"
  on public.teams for select to authenticated using (true);
drop policy if exists "teams: создать капитаном" on public.teams;
create policy "teams: создать капитаном"
  on public.teams for insert to authenticated with check (captain_id = auth.uid());

-- registrations
drop policy if exists "registrations: записаться самому" on public.registrations;
create policy "registrations: записаться самому"
  on public.registrations for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists "registrations: видеть свои / автору / судье" on public.registrations;
create policy "registrations: видеть свои / автору / судье"
  on public.registrations for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_event_author(event_id)
    or exists (
      select 1 from public.event_judges j
      where j.event_id = registrations.event_id
        and j.user_id = auth.uid()
        and j.status = 'accepted'
    )
  );
drop policy if exists "registrations: автор управляет статусом" on public.registrations;
create policy "registrations: автор управляет статусом"
  on public.registrations for update to authenticated
  using (public.is_event_author(event_id));
drop policy if exists "registrations: удалить свою или автору" on public.registrations;
create policy "registrations: удалить свою или автору"
  on public.registrations for delete to authenticated
  using (user_id = auth.uid() or public.is_event_author(event_id));

-- solutions
drop policy if exists "solutions: загрузить своё решение" on public.solutions;
create policy "solutions: загрузить своё решение"
  on public.solutions for insert to authenticated
  with check (
    exists (
      select 1 from public.registrations r
      where r.id = registration_id and r.user_id = auth.uid()
    )
  );
drop policy if exists "solutions: видеть владельцу / автору / судье" on public.solutions;
create policy "solutions: видеть владельцу / автору / судье"
  on public.solutions for select to authenticated
  using (
    exists (
      select 1 from public.registrations r
      where r.id = solutions.registration_id
        and (
          r.user_id = auth.uid()
          or public.is_event_judge(r.event_id)
        )
    )
  );
drop policy if exists "solutions: владелец или судья обновляет" on public.solutions;
create policy "solutions: владелец или судья обновляет"
  on public.solutions for update to authenticated
  using (
    exists (
      select 1 from public.registrations r
      where r.id = solutions.registration_id
        and (r.user_id = auth.uid() or public.is_event_judge(r.event_id))
    )
  );

-- event_judges
drop policy if exists "judges: видеть свои приглашения и автора" on public.event_judges;
create policy "judges: видеть свои приглашения и автора"
  on public.event_judges for select to authenticated
  using (user_id = auth.uid() or public.is_event_author(event_id));
drop policy if exists "judges: автор назначает" on public.event_judges;
create policy "judges: автор назначает"
  on public.event_judges for insert to authenticated
  with check (public.is_event_author(event_id));
drop policy if exists "judges: приглашённый отвечает / автор меняет" on public.event_judges;
create policy "judges: приглашённый отвечает / автор меняет"
  on public.event_judges for update to authenticated
  using (user_id = auth.uid() or public.is_event_author(event_id));
drop policy if exists "judges: автор отзывает" on public.event_judges;
create policy "judges: автор отзывает"
  on public.event_judges for delete to authenticated
  using (public.is_event_author(event_id));

-- scores
drop policy if exists "scores: судья ставит оценку" on public.scores;
create policy "scores: судья ставит оценку"
  on public.scores for insert to authenticated
  with check (
    judge_id = auth.uid()
    and exists (
      select 1
      from public.solutions s
      join public.registrations r on r.id = s.registration_id
      where s.id = solution_id and public.is_event_judge(r.event_id)
    )
  );
drop policy if exists "scores: судья правит свою оценку" on public.scores;
create policy "scores: судья правит свою оценку"
  on public.scores for update to authenticated
  using (judge_id = auth.uid())
  with check (judge_id = auth.uid());
drop policy if exists "scores: видеть участникам события" on public.scores;
create policy "scores: видеть участникам события"
  on public.scores for select to authenticated
  using (
    exists (
      select 1
      from public.solutions s
      join public.registrations r on r.id = s.registration_id
      where s.id = solution_id
        and (r.user_id = auth.uid() or public.is_event_judge(r.event_id))
    )
  );

-- ============================================================
-- Представления
-- ============================================================

-- Статистика мероприятий (счётчики публичны, данные не раскрывают)
create or replace view public.event_stats as
select
  e.id as event_id,
  (select count(*) from public.registrations r where r.event_id = e.id) as participants_count,
  (
    select count(*)
    from public.solutions s
    join public.registrations r2 on r2.id = s.registration_id
    where r2.event_id = e.id
  ) as solutions_count
from public.events e;

-- Таблица лидеров: суммы баллов по командам/участникам
create or replace view public.leaderboard as
select
  r.event_id,
  e.title                as event_title,
  r.id                   as registration_id,
  r.team_id,
  t.name                 as team_name,
  p.full_name            as participant_name,
  coalesce(sum(sc.score), 0)::int as total_score,
  count(distinct sc.judge_id)::int as judges_count,
  max(sc.created_at)     as last_scored_at
from public.registrations r
join public.events e   on e.id = r.event_id
left join public.teams t on t.id = r.team_id
left join public.profiles p on p.id = r.user_id
left join public.solutions s on s.registration_id = r.id
left join public.scores sc  on sc.solution_id = s.id
group by r.event_id, e.title, r.id, r.team_id, t.name, p.full_name;

-- Публичные баллы решения (обходят RLS scores для анонима)
create or replace function public.solution_total_score(sid uuid)
returns int
language sql stable security definer set search_path = public
as $$
  select coalesce(sum(score), 0)::int from public.scores where solution_id = sid;
$$;

create or replace function public.solution_judges_count(sid uuid)
returns int
language sql stable security definer set search_path = public
as $$
  select count(distinct judge_id)::int from public.scores where solution_id = sid;
$$;

-- Решения и оценки публичны после публикации итогов события
drop policy if exists "solutions: публичны после публикации итогов" on public.solutions;
create policy "solutions: публичны после публикации итогов"
  on public.solutions for select
  using (
    exists (
      select 1
      from public.registrations r
      join public.events e on e.id = r.event_id
      where r.id = solutions.registration_id
        and e.results_published_at is not null
    )
  );

drop policy if exists "scores: публичны после публикации итогов" on public.scores;
create policy "scores: публичны после публикации итогов"
  on public.scores for select
  using (
    exists (
      select 1
      from public.solutions s
      join public.registrations r on r.id = s.registration_id
      join public.events e on e.id = r.event_id
      where s.id = scores.solution_id
        and e.results_published_at is not null
    )
  );

-- Карточки решений (для судей, организатора и публичной галереи)
create or replace view public.solution_cards with (security_invoker = true) as
select
  s.id,
  s.registration_id,
  s.title,
  s.description,
  s.file_path,
  s.status,
  s.created_at,
  r.event_id,
  r.team_id,
  r.case_id,
  t.name  as team_name,
  e.title as event_title,
  c.title as case_title,
  coalesce(public.solution_total_score(s.id), 0) as total_score,
  coalesce(public.solution_judges_count(s.id), 0) as judges_count,
  e.results_published_at
from public.solutions s
join public.registrations r on r.id = s.registration_id
join public.events e        on e.id = r.event_id
left join public.teams t    on t.id = r.team_id
left join public.cases c    on c.id = r.case_id;

-- ============================================================
-- Storage: bucket для файлов решений
-- ============================================================
insert into storage.buckets (id, name, public)
values ('solutions', 'solutions', true)
on conflict (id) do nothing;

drop policy if exists "solutions: читать файлы" on storage.objects;
create policy "solutions: читать файлы"
  on storage.objects for select
  using (bucket_id = 'solutions');
drop policy if exists "solutions: загружать авторизованным" on storage.objects;
create policy "solutions: загружать авторизованным"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'solutions');
drop policy if exists "solutions: владелец управляет файлом" on storage.objects;
create policy "solutions: владелец управляет файлом"
  on storage.objects for update to authenticated
  using (bucket_id = 'solutions' and owner_id = auth.uid()::text);

-- ============================================================
-- Уведомления
-- ============================================================
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  type       text not null default 'info',
  title      text not null,
  body       text not null default '',
  link       text not null default '',
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx on public.notifications(user_id);
create index if not exists notifications_read_idx on public.notifications(user_id, read);

alter table public.notifications enable row level security;

drop policy if exists "notifications: читать свои" on public.notifications;
create policy "notifications: читать свои"
  on public.notifications for select to authenticated
  using (user_id = auth.uid());
drop policy if exists "notifications: обновлять свои" on public.notifications;
create policy "notifications: обновлять свои"
  on public.notifications for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Триггеры уведомлений (заявка, статус, судьи, решения, оценки)
create or replace function public.fn_notify_registration_created()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_author uuid;
  v_title  text;
  v_is_lecture boolean;
begin
  select e.author_id, e.title, (e.format = 'lecture')
    into v_author, v_title, v_is_lecture
  from public.events e where e.id = new.event_id;
  insert into public.notifications (user_id, type, title, body, link)
  values (
    v_author, 'registration',
    case when v_is_lecture then 'Новая запись на лекцию' else 'Новая заявка команды' end,
    v_title, '/my/events/' || new.event_id::text
  );
  return new;
end;
$$;
drop trigger if exists trg_registration_created on public.registrations;
create trigger trg_registration_created
  after insert on public.registrations
  for each row execute function public.fn_notify_registration_created();

create or replace function public.fn_notify_registration_status()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_title text;
begin
  if new.status is distinct from old.status then
    select e.title into v_title from public.events e where e.id = new.event_id;
    insert into public.notifications (user_id, type, title, body, link)
    values (
      new.user_id, 'registration',
      case new.status
        when 'approved' then 'Заявка одобрена'
        when 'rejected' then 'Заявка отклонена'
        else 'Статус заявки обновлён'
      end,
      v_title, '/my/registrations'
    );
  end if;
  return new;
end;
$$;
drop trigger if exists trg_registration_status on public.registrations;
create trigger trg_registration_status
  after update on public.registrations
  for each row execute function public.fn_notify_registration_status();

create or replace function public.fn_notify_judge_invited()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_title text;
begin
  select e.title into v_title from public.events e where e.id = new.event_id;
  insert into public.notifications (user_id, type, title, body, link)
  values (
    new.user_id, 'judge', 'Приглашение в жюри',
    'Вас пригласили судьёй на «' || v_title || '»', '/judge'
  );
  return new;
end;
$$;
drop trigger if exists trg_judge_invited on public.event_judges;
create trigger trg_judge_invited
  after insert on public.event_judges
  for each row execute function public.fn_notify_judge_invited();

create or replace function public.fn_notify_judge_accepted()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_author uuid; v_judge_name text;
begin
  if new.status = 'accepted' and (old.status is distinct from 'accepted') then
    select e.author_id into v_author from public.events e where e.id = new.event_id;
    select p.full_name into v_judge_name from public.profiles p where p.id = new.user_id;
    insert into public.notifications (user_id, type, title, body, link)
    values (
      v_author, 'judge', 'Судья подтвердил участие',
      coalesce(v_judge_name, 'Судья') || ' будет оценивать работы',
      '/my/events/' || new.event_id::text
    );
  end if;
  return new;
end;
$$;
drop trigger if exists trg_judge_accepted on public.event_judges;
create trigger trg_judge_accepted
  after update on public.event_judges
  for each row execute function public.fn_notify_judge_accepted();

create or replace function public.fn_notify_solution_uploaded()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_author uuid; v_team text;
begin
  select e.author_id, t.name into v_author, v_team
  from public.solutions s
  join public.registrations r on r.id = s.registration_id
  join public.events e on e.id = r.event_id
  left join public.teams t on t.id = r.team_id
  where s.id = new.id;
  insert into public.notifications (user_id, type, title, body, link)
  values (
    v_author, 'solution', 'Новое решение',
    coalesce(v_team, 'Участник') || ' — «' || new.title || '»',
    '/my/events/' || (
      select r.event_id from public.registrations r where r.id = new.registration_id
    )::text
  );
  return new;
end;
$$;
drop trigger if exists trg_solution_uploaded on public.solutions;
create trigger trg_solution_uploaded
  after insert on public.solutions
  for each row execute function public.fn_notify_solution_uploaded();

create or replace function public.fn_notify_score_added()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_participant uuid;
begin
  select r.user_id into v_participant
  from public.solutions s
  join public.registrations r on r.id = s.registration_id
  where s.id = new.solution_id;
  insert into public.notifications (user_id, type, title, body, link)
  values (
    v_participant, 'score', 'Работа оценена',
    'Судья выставил баллы за ваше решение', '/my/registrations'
  );
  return new;
end;
$$;
drop trigger if exists trg_score_added on public.scores;
create trigger trg_score_added
  after insert on public.scores
  for each row execute function public.fn_notify_score_added();

-- Публикация итогов (RPC, вызывает только автор)
create or replace function public.publish_results(ev uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_event_author(ev) then
    raise exception 'Публиковать итоги может только автор мероприятия';
  end if;
  update public.events
  set results_published_at = now()
  where id = ev and results_published_at is null;
  insert into public.notifications (user_id, type, title, body, link)
  select r.user_id, 'results', 'Итоги опубликованы', e.title, '/events/' || ev::text
  from public.registrations r
  join public.events e on e.id = r.event_id
  where r.event_id = ev and r.status = 'approved';
end;
$$;
grant execute on function public.publish_results(uuid) to authenticated;

-- Storage: bucket обложек
insert into storage.buckets (id, name, public)
values ('covers', 'covers', true)
on conflict (id) do nothing;

drop policy if exists "covers: читать файлы" on storage.objects;
create policy "covers: читать файлы"
  on storage.objects for select
  using (bucket_id = 'covers');
drop policy if exists "covers: загружать авторизованным" on storage.objects;
create policy "covers: загружать авторизованным"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'covers');
drop policy if exists "covers: владелец управляет файлом" on storage.objects;
create policy "covers: владелец управляет файлом"
  on storage.objects for update to authenticated
  using (bucket_id = 'covers' and owner_id = auth.uid()::text);

-- ============================================================
-- Теги, интересы, сигналы (умная лента)
-- ============================================================
create table if not exists public.tags (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  emoji      text not null default '',
  sort_order int  not null default 0
);

create table if not exists public.event_tags (
  event_id uuid not null references public.events(id) on delete cascade,
  tag_id   uuid not null references public.tags(id) on delete cascade,
  primary key (event_id, tag_id)
);

create table if not exists public.profile_interests (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tag_id     uuid not null references public.tags(id) on delete cascade,
  primary key (profile_id, tag_id)
);

create table if not exists public.event_views (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references public.profiles(id) on delete cascade,
  event_id  uuid not null references public.events(id) on delete cascade,
  viewed_at timestamptz not null default now()
);
create index if not exists event_views_user_idx  on public.event_views(user_id);
create index if not exists event_views_event_idx on public.event_views(event_id);

create table if not exists public.event_hides (
  user_id   uuid not null references public.profiles(id) on delete cascade,
  event_id  uuid not null references public.events(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

create table if not exists public.event_favorites (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  event_id   uuid not null references public.events(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

create index if not exists event_favorites_user_idx on public.event_favorites(user_id);

alter table public.tags              enable row level security;
alter table public.event_tags        enable row level security;
alter table public.profile_interests enable row level security;
alter table public.event_views       enable row level security;
alter table public.event_hides       enable row level security;
alter table public.event_favorites   enable row level security;

drop policy if exists "tags: публичны" on public.tags;
create policy "tags: публичны"
  on public.tags for select using (true);

drop policy if exists "event_tags: публичны" on public.event_tags;
create policy "event_tags: публичны"
  on public.event_tags for select using (true);
drop policy if exists "event_tags: управляет автор" on public.event_tags;
create policy "event_tags: управляет автор"
  on public.event_tags for all to authenticated
  using (public.is_event_author(event_id))
  with check (public.is_event_author(event_id));

drop policy if exists "interests: свои" on public.profile_interests;
create policy "interests: свои"
  on public.profile_interests for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

drop policy if exists "views: свои" on public.event_views;
create policy "views: свои"
  on public.event_views for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "hides: свои" on public.event_hides;
create policy "hides: свои"
  on public.event_hides for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "favorites: свои" on public.event_favorites;
create policy "favorites: свои"
  on public.event_favorites for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Демо-теги
insert into public.tags (id, name, emoji, sort_order) values
  ('aaaaaaa0-0000-4000-8000-000000000001', 'Робототехника',             '🤖', 1),
  ('aaaaaaa0-0000-4000-8000-000000000002', 'Искусственный интеллект',   '🧠', 2),
  ('aaaaaaa0-0000-4000-8000-000000000003', 'Эко и устойчивость',        '🌱', 3),
  ('aaaaaaa0-0000-4000-8000-000000000004', 'Электроника',               '⚡', 4),
  ('aaaaaaa0-0000-4000-8000-000000000005', '3D-печать',                 '🖨️', 5),
  ('aaaaaaa0-0000-4000-8000-000000000006', 'Дизайн',                    '🎨', 6),
  ('aaaaaaa0-0000-4000-8000-000000000007', 'Программирование',          '💻', 7),
  ('aaaaaaa0-0000-4000-8000-000000000008', 'Городская среда',           '🏙️', 8),
  ('aaaaaaa0-0000-4000-8000-000000000009', 'Космос',                    '🚀', 9),
  ('aaaaaaa0-0000-4000-8000-00000000000a', 'Биология',                  '🧬', 10),
  ('aaaaaaa0-0000-4000-8000-00000000000b', 'Для начинающих',            '🌟', 11),
  ('aaaaaaa0-0000-4000-8000-00000000000c', 'Лекции и митапы',           '🎤', 12)
on conflict (name) do nothing;

insert into public.event_tags (event_id, tag_id) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaa0-0000-4000-8000-000000000008'),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaa0-0000-4000-8000-000000000001'),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaa0-0000-4000-8000-000000000004'),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaa0-0000-4000-8000-000000000003'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaa0-0000-4000-8000-000000000007'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaa0-0000-4000-8000-000000000002'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaa0-0000-4000-8000-00000000000b'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'aaaaaaa0-0000-4000-8000-000000000001'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'aaaaaaa0-0000-4000-8000-00000000000b'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'aaaaaaa0-0000-4000-8000-00000000000c'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'aaaaaaa0-0000-4000-8000-000000000002'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'aaaaaaa0-0000-4000-8000-00000000000c'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'aaaaaaa0-0000-4000-8000-000000000007')
on conflict do nothing;


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
drop view if exists public.event_stats;
create view public.event_stats as
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


-- ============================================================
-- КейсПортал — Фаза 2 умной ленты:
--  1) get_feed() — серверный скоринг (регистрации ×5, избранное ×3,
--     интересы ×2, просмотры ×1, свежесть и популярность)
--  2) event_cooccurrence — «с этим событием также»
-- Запустить в SQL Editor. Идемпотентно.
-- ============================================================

create or replace function public.get_feed()
returns table (
  id uuid,
  title text,
  description text,
  format text,
  place text,
  starts_at timestamptz,
  registration_deadline timestamptz,
  status text,
  author_id uuid,
  cover_path text,
  results_published_at timestamptz,
  capacity int,
  score numeric,
  match_count int,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with signals as (
      select s.event_id, s.weight, et.tag_id
      from (
          select r.event_id, 5::numeric as weight
          from public.registrations r
          where r.user_id = auth.uid()
          union all
          select f.event_id, 3::numeric
          from public.event_favorites f
          where f.user_id = auth.uid()
          union all
          select v.event_id, 1::numeric
          from public.event_views v
          where v.user_id = auth.uid()
      ) s
      join public.event_tags et on et.event_id = s.event_id
      union all
      select null::uuid, 2::numeric, pi.tag_id
      from public.profile_interests pi
      where pi.profile_id = auth.uid()
  ),
  taste as (
      select tag_id, sum(weight) as weight
      from signals
      group by tag_id
  ),
  event_scores as (
      select et.event_id,
             sum(t.weight) as tag_score,
             count(*)::int as match_count
      from public.event_tags et
      join taste t on t.tag_id = et.tag_id
      group by et.event_id
  )
  select
      e.id,
      e.title,
      e.description,
      e.format,
      e.place,
      e.starts_at,
      e.registration_deadline,
      e.status,
      e.author_id,
      e.cover_path,
      e.results_published_at,
      e.capacity,
      round(
          coalesce(es.tag_score, 0)
          + (case when e.starts_at is not null and e.starts_at > now() then 0.5 else 0 end)
          + least(
              (select count(*) from public.registrations r where r.event_id = e.id) * 0.1,
              1.5
            ),
          2
      ) as score,
      coalesce(es.match_count, 0) as match_count,
      e.created_at
  from public.events e
  left join event_scores es on es.event_id = e.id
  where e.status = 'published'
    and not exists (
      select 1 from public.event_hides h
      where h.user_id = auth.uid() and h.event_id = e.id
    )
  order by
      score desc,
      e.starts_at asc nulls last;
$$;

grant execute on function public.get_feed() to anon, authenticated;

-- ---------- Co-occurrence: совместные просмотры и сохранения ----------
create or replace view public.event_cooccurrence as
with signals as (
    select user_id, event_id from public.event_views
    union
    select user_id, event_id from public.event_favorites
)
select
    a.event_id,
    b.event_id as related_id,
    count(*)::int as strength
from signals a
join signals b
  on a.user_id = b.user_id
 and a.event_id <> b.event_id
group by a.event_id, b.event_id;


-- ============================================================
-- КейсПортал — Фаза 3: нейросетевые эмбеддинги (BGE-M3, 1024)
-- Ollama считает вектора, портал кладёт их в events.embedding.
-- Запустить в SQL Editor. Идемпотентно.
-- ============================================================

create extension if not exists vector with schema extensions;

alter table public.events add column if not exists embedding extensions.vector(1024);

create index if not exists events_embedding_idx on public.events
  using ivfflat (embedding extensions.vector_cosine_ops)
  with (lists = 100);

-- ---------- get_feed v2: теги + косинусная близость профиля вкуса ----------
drop function if exists public.get_feed();

create or replace function public.get_feed(profile_embedding extensions.vector default null)
returns table (
  id uuid,
  title text,
  description text,
  format text,
  place text,
  starts_at timestamptz,
  registration_deadline timestamptz,
  status text,
  author_id uuid,
  cover_path text,
  results_published_at timestamptz,
  capacity int,
  score numeric,
  match_count int,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with signals as (
      select s.event_id, s.weight, et.tag_id
      from (
          select r.event_id, 5::numeric as weight
          from public.registrations r
          where r.user_id = auth.uid()
          union all
          select f.event_id, 3::numeric
          from public.event_favorites f
          where f.user_id = auth.uid()
          union all
          select v.event_id, 1::numeric
          from public.event_views v
          where v.user_id = auth.uid()
      ) s
      join public.event_tags et on et.event_id = s.event_id
      union all
      select null::uuid, 2::numeric, pi.tag_id
      from public.profile_interests pi
      where pi.profile_id = auth.uid()
  ),
  taste as (
      select tag_id, sum(weight) as weight
      from signals
      group by tag_id
  ),
  event_scores as (
      select et.event_id,
             sum(t.weight) as tag_score,
             count(*)::int as match_count
      from public.event_tags et
      join taste t on t.tag_id = et.tag_id
      group by et.event_id
  )
  select
      e.id,
      e.title,
      e.description,
      e.format,
      e.place,
      e.starts_at,
      e.registration_deadline,
      e.status,
      e.author_id,
      e.cover_path,
      e.results_published_at,
      e.capacity,
      round(
          (
              coalesce(es.tag_score, 0)
              + case
                  when profile_embedding is not null and e.embedding is not null
                    then 4.0 * (1 - (e.embedding <=> profile_embedding))
                  else 0
                end
              + (case when e.starts_at is not null and e.starts_at > now() then 0.5 else 0 end)
              + least(
                  (select count(*) from public.registrations r where r.event_id = e.id) * 0.1,
                  1.5
                )
          )::numeric,
          2
      ) as score,
      coalesce(es.match_count, 0) as match_count,
      e.created_at
  from public.events e
  left join event_scores es on es.event_id = e.id
  where e.status = 'published'
    and not exists (
      select 1 from public.event_hides h
      where h.user_id = auth.uid() and h.event_id = e.id
    )
  order by
      score desc,
      e.starts_at asc nulls last;
$$;

grant execute on function public.get_feed(extensions.vector) to anon, authenticated;

-- ---------- Похожие события по вектору ----------
create or replace function public.similar_events(
  ev uuid,
  limit_count int default 3
)
returns table (
  id uuid,
  title text,
  place text,
  starts_at timestamptz,
  similarity numeric
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
      e2.id,
      e2.title,
      e2.place,
      e2.starts_at,
      round((1 - (e2.embedding <=> e.embedding))::numeric, 3) as similarity
  from public.events e2
  cross join (select embedding from public.events where id = ev) e
  where e2.id <> ev
    and e2.status = 'published'
    and e.embedding is not null
    and e2.embedding is not null
  order by e2.embedding <=> e.embedding
  limit least(greatest(limit_count, 1), 10);
$$;

grant execute on function public.similar_events(uuid, int) to anon, authenticated;
