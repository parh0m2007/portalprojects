-- ============================================================
-- КейсПортал — фикс: публичные работы и оценки после публикации итогов
--
-- Проблема: политики решений/оценок ссылаются на registrations,
-- которая сама закрыта RLS, поэтому подзапрос политик не видел
-- строки и работы не отображались в галерее /works.
-- Решение: security definer функция, обходящая RLS registrations.
-- ============================================================

-- Публикованы ли итоги события, к которому относится решение
create or replace function public.is_solution_published(sid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.registrations r
    join public.events e on e.id = r.event_id
    where r.id = (select s.registration_id from public.solutions s where s.id = sid)
      and e.results_published_at is not null
  );
$$;

-- solutions: публичны после публикации итогов (без зависимости от RLS registrations)
drop policy if exists "solutions: публичны после публикации итогов" on public.solutions;
create policy "solutions: публичны после публикации итогов"
  on public.solutions for select
  using (public.is_solution_published(id));

-- scores: публичны после публикации итогов (аналогично)
drop policy if exists "scores: публичны после публикации итогов" on public.scores;
create policy "scores: публичны после публикации итогов"
  on public.scores for select
  using (public.is_solution_published(solution_id));
