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
