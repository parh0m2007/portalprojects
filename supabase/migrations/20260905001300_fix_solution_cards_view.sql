-- ============================================================
-- КейсПортал — фикс вью solution_cards для публичной галереи
--
-- Проблема: view security_invoker джойнит registrations и cases,
-- которые закрыты RLS для анонимов — из-за этого view возвращал
-- 0 строк, хотя сами solutions уже были публичны.
-- Решение: security definer функция get_solution_cards(),
-- которая собирает карточки и одновременно применяет права:
--   * работы публичных событий с опубликованными итогами — всем;
--   * свои работы и работы своих событий (судья/автор) — авторизованным.
-- ============================================================

create or replace function public.get_solution_cards()
returns table (
  id uuid,
  registration_id uuid,
  title text,
  description text,
  file_path text,
  status text,
  created_at timestamptz,
  event_id uuid,
  team_id uuid,
  case_id uuid,
  team_name text,
  event_title text,
  case_title text,
  total_score int,
  judges_count int,
  results_published_at timestamptz
)
language sql stable security definer set search_path = public
as $$
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
    coalesce(public.solution_total_score(s.id), 0)::int as total_score,
    coalesce(public.solution_judges_count(s.id), 0)::int as judges_count,
    e.results_published_at
  from public.solutions s
  join public.registrations r on r.id = s.registration_id
  join public.events e        on e.id = r.event_id
  left join public.teams t    on t.id = r.team_id
  left join public.cases c    on c.id = r.case_id
  where
    -- публично: итоги события опубликованы
    e.results_published_at is not null
    -- или это работа самого пользователя
    or r.user_id = auth.uid()
    -- или пользователь судья / автор события
    or public.is_event_judge(r.event_id);
$$;

grant execute on function public.get_solution_cards() to anon, authenticated;

-- Заменяем view на обёртку над функцией
drop view if exists public.solution_cards;
create view public.solution_cards as
  select * from public.get_solution_cards();
