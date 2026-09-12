-- ============================================================
-- КейсПортал — миграция: обложки, уведомления, публикация итогов
-- Запустить в SQL Editor (после schema.sql). Идемпотентно.
-- ============================================================

-- ---------- Новые поля мероприятия ----------
alter table public.events add column if not exists cover_path text;
alter table public.events add column if not exists results_published_at timestamptz;

-- ---------- Уведомления ----------
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

-- ---------- Триггеры уведомлений ----------
-- Заявка создана -> организатору
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
    v_author,
    'registration',
    case when v_is_lecture then 'Новая запись на лекцию' else 'Новая заявка команды' end,
    v_title,
    '/my/events/' || new.event_id::text
  );
  return new;
end;
$$;

drop trigger if exists trg_registration_created on public.registrations;
create trigger trg_registration_created
  after insert on public.registrations
  for each row execute function public.fn_notify_registration_created();

-- Статус заявки изменён -> участнику
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
      new.user_id,
      'registration',
      case new.status
        when 'approved' then 'Заявка одобрена'
        when 'rejected' then 'Заявка отклонена'
        else 'Статус заявки обновлён'
      end,
      v_title,
      '/my/registrations'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_registration_status on public.registrations;
create trigger trg_registration_status
  after update on public.registrations
  for each row execute function public.fn_notify_registration_status();

-- Судья приглашён -> приглашённому
create or replace function public.fn_notify_judge_invited()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_title text;
begin
  select e.title into v_title from public.events e where e.id = new.event_id;
  insert into public.notifications (user_id, type, title, body, link)
  values (
    new.user_id,
    'judge',
    'Приглашение в жюри',
    'Вас пригласили судьёй на «' || v_title || '»',
    '/judge'
  );
  return new;
end;
$$;

drop trigger if exists trg_judge_invited on public.event_judges;
create trigger trg_judge_invited
  after insert on public.event_judges
  for each row execute function public.fn_notify_judge_invited();

-- Судья принял приглашение -> организатору
create or replace function public.fn_notify_judge_accepted()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_author uuid;
  v_judge_name text;
begin
  if new.status = 'accepted' and (old.status is distinct from 'accepted') then
    select e.author_id into v_author from public.events e where e.id = new.event_id;
    select p.full_name into v_judge_name from public.profiles p where p.id = new.user_id;
    insert into public.notifications (user_id, type, title, body, link)
    values (
      v_author,
      'judge',
      'Судья подтвердил участие',
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

-- Решение загружено -> организатору
create or replace function public.fn_notify_solution_uploaded()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_author uuid;
  v_team   text;
begin
  select e.author_id, t.name
    into v_author, v_team
  from public.solutions s
  join public.registrations r on r.id = s.registration_id
  join public.events e on e.id = r.event_id
  left join public.teams t on t.id = r.team_id
  where s.id = new.id;

  insert into public.notifications (user_id, type, title, body, link)
  values (
    v_author,
    'solution',
    'Новое решение',
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

-- Оценка поставлена -> автору работы
create or replace function public.fn_notify_score_added()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_participant uuid;
  v_event uuid;
begin
  select r.user_id, r.event_id into v_participant, v_event
  from public.solutions s
  join public.registrations r on r.id = s.registration_id
  where s.id = new.solution_id;

  insert into public.notifications (user_id, type, title, body, link)
  values (
    v_participant,
    'score',
    'Работа оценена',
    'Судья выставил баллы за ваше решение',
    '/my/registrations'
  );
  return new;
end;
$$;

drop trigger if exists trg_score_added on public.scores;
create trigger trg_score_added
  after insert on public.scores
  for each row execute function public.fn_notify_score_added();

-- ---------- Публикация итогов ----------
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
  select
    r.user_id,
    'results',
    'Итоги опубликованы',
    e.title,
    '/events/' || ev::text
  from public.registrations r
  join public.events e on e.id = r.event_id
  where r.event_id = ev and r.status = 'approved';
end;
$$;

grant execute on function public.publish_results(uuid) to authenticated;

-- ---------- Storage: bucket обложек ----------
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
