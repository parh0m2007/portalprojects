-- ============================================================
-- КейсПортал — миграция: публичная галерея работ
-- Решения становятся публичными после публикации итогов события.
-- Запустить в SQL Editor. Идемпотентно.
-- ============================================================

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

-- Решения публичны, когда итоги события опубликованы
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

-- Оценки публичны после публикации итогов
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

-- Обновляем представление: публичные баллы + дата публикации итогов
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
