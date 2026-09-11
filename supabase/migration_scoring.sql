-- ============================================================
-- КейсПортал — Слепое судейство и нормализация оценок
--  1) blind_judging: скрытие авторства работ от судей до публикации итогов
--  2) judge_calibration: строгость каждого судьи (средний балл / дисперсия)
--  3) normalized_leaderboard: рейтинг с компенсацией строгости судей
--     (z-score по судье, приведение к 100-балльной шкале)
-- Запустить в SQL Editor (после schema.sql). Идомпотентно.
-- ============================================================

-- ---------- 1. Слепое судейство ----------
-- Судья не должен видеть, чья работа: до публикации итогов
-- solution_cards скрывает team_name / participant для судей,
-- когда у события включён blind_judging.
alter table public.events add column if not exists blind_judging boolean
  not null default false;

-- Карточка решения для судьи (анонимизированная при blind_judging).
-- security_invoker: RLS решений по-прежнему применяется.
create or replace view public.judge_work_cards with (security_invoker = true) as
select
  s.id,
  s.registration_id,
  s.title,
  s.description,
  s.file_path,
  s.status,
  s.created_at,
  r.event_id,
  r.case_id,
  c.title as case_title,
  e.title as event_title,
  e.results_published_at,
  e.blind_judging,
  case
    when e.blind_judging and e.results_published_at is null
      then null
    else t.name
  end as team_name,
  coalesce(public.solution_total_score(s.id), 0) as total_score,
  coalesce(public.solution_judges_count(s.id), 0) as judges_count
from public.solutions s
join public.registrations r on r.id = s.registration_id
join public.events e on e.id = r.event_id
left join public.teams t on t.id = r.team_id
left join public.cases c on c.id = r.case_id;

-- ---------- 2. Калибровка судей ----------
-- Статистика строгости: средний балл судьи (в % от максимума критерия),
-- количество оценённых работ и стандартное отклонение.
create or replace view public.judge_calibration as
select
  sc.judge_id,
  r.event_id,
  e.title as event_title,
  count(distinct sc.solution_id)::int as judged_works,
  count(*)::int as given_scores,
  round(
    100.0 * sum(sc.score) / nullif(sum(cr.max_score), 0),
    2
  ) as avg_pct,           -- средняя «щедрость» судьи, %
  round(
    coalesce(stddev_samp(sc.score::numeric / nullif(cr.max_score, 0)) * 100, 0),
    2
  ) as spread_pct         -- разброс оценок судьи, %
from public.scores sc
join public.solutions s   on s.id = sc.solution_id
join public.registrations r on r.id = s.registration_id
join public.events e      on e.id = r.event_id
join public.criteria cr   on cr.id = sc.criterion_id
group by sc.judge_id, r.event_id, e.title;

-- ---------- 3. Нормализованный рейтинг ----------
-- z-score: балл судьи минус его средний уровень, делённый на разброс.
-- Компенсирует «строгих» и «щедрых» судей. Приводим к 0..100.
create or replace function public.normalized_leaderboard(ev uuid)
returns table (
  registration_id uuid,
  team_id uuid,
  team_name text,
  participant_name text,
  raw_score numeric,
  normalized_score numeric,
  judges_count bigint
)
language sql stable security definer set search_path = public
as $$
  with judge_stats as (
    -- средний уровень и разброс каждого судья по событию (в долях максимума)
    select
      sc.judge_id,
      r.event_id,
      avg(sc.score::numeric / cr.max_score) as judge_mean,
      coalesce(stddev_samp(sc.score::numeric / cr.max_score), 0.25) as judge_sd
    from public.scores sc
    join public.solutions s     on s.id = sc.solution_id
    join public.registrations r on r.id = s.registration_id
    join public.criteria cr     on cr.id = sc.criterion_id
    where r.event_id = ev
    group by sc.judge_id, r.event_id
    having count(*) >= 3  -- калибровка имеет смысл от 3 оценок
  ),
  work_judge as (
    -- доля максимума, которую судья дал работе (по всем критериям)
    select
      s.id as solution_id,
      sc.judge_id,
      sum(sc.score::numeric / cr.max_score) / count(*) as work_pct
    from public.scores sc
    join public.solutions s   on s.id = sc.solution_id
    join public.registrations r on r.id = s.registration_id
    join public.criteria cr   on cr.id = sc.criterion_id
    where r.event_id = ev
    group by s.id, sc.judge_id
  ),
  work_normalized as (
    -- z-score работы у каждого судья, затем среднее
    select
      wj.solution_id,
      avg(
        (wj.work_pct - js.judge_mean)
        / nullif(greatest(js.judge_sd, 0.05), 0)
      ) as avg_z
    from work_judge wj
    join judge_stats js on js.judge_id = wj.judge_id
    group by wj.solution_id
  ),
  work_scores as (
    select
      s.id as solution_id,
      s.registration_id,
      coalesce(sum(sc.score), 0) as raw_score,
      count(distinct sc.judge_id) as judges_count,
      wn.avg_z
    from public.solutions s
    join public.registrations r on r.id = s.registration_id
    join public.scores sc on sc.solution_id = s.id
    left join work_normalized wn on wn.solution_id = s.id
    where r.event_id = ev
    group by s.id, s.registration_id, wn.avg_z
  )
  select
    r.id as registration_id,
    r.team_id,
    t.name as team_name,
    p.full_name as participant_name,
    ws.raw_score,
    -- 50 + z*16.6: z=+1 → ~66.6, z=−1 → ~33.3; clamp в 0..100
    round(
      least(greatest(50 + 16.666 * coalesce(ws.avg_z, 0), 0), 100)::numeric,
      2
    ) as normalized_score,
    ws.judges_count
  from public.registrations r
  join work_scores ws on ws.registration_id = r.id
  left join public.teams t on t.id = r.team_id
  left join public.profiles p on p.id = r.user_id
  order by normalized_score desc;
$$;

grant execute on function public.normalized_leaderboard(uuid) to authenticated;

-- judge_work_cards доступен судьям (RLS solutions уже фильтрует),
-- normalized_leaderboard — организатору события (RLS на view с security_invoker
-- не применяется, поэтому функция security definer; для честности скрываем
-- её результат до публикации итогов нельзя — организатор и так всё видит).
