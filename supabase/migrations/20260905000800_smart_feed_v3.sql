-- ============================================================
-- КейсПортал — Фаза 4: живая лента как в Pinterest
--   1. Поисковые запросы как сильный сигнал вкуса (эмбеддинг запроса).
--   2. Затухание сигналов по времени: вес × exp(-возраст/21 день).
--   3. Скрытие давит ТЕМУ: −2 к тегам скрытого события.
-- Запустить в SQL Editor. Идемпотентно.
-- ============================================================

create extension if not exists vector with schema extensions;

-- ---------- 1. Поисковые запросы ----------
create table if not exists public.search_queries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  query       text not null,
  embedding   extensions.vector(1024),
  searched_at timestamptz not null default now()
);

create index if not exists search_queries_user_idx on public.search_queries(user_id);
create index if not exists search_queries_time_idx on public.search_queries(searched_at);

alter table public.search_queries enable row level security;

drop policy if exists "searches: свои" on public.search_queries;
create policy "searches: свои"
  on public.search_queries for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------- get_feed v3: затухание + отрицательные веса ----------
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
  -- τ = 21 день (1814400 сек): сигнал недельной давности весит ~0.72,
  -- трёхнедельный — ~0.37, двухмесячный — почти ноль.
  with signals as (
      -- регистрации ×5
      select r.event_id,
             5::numeric * exp(-extract(epoch from (now() - r.created_at)) / 1814400.0) as weight,
             et.tag_id
      from public.registrations r
      join public.event_tags et on et.event_id = r.event_id
      where r.user_id = auth.uid()
      union all
      -- избранное ×3
      select f.event_id,
             3::numeric * exp(-extract(epoch from (now() - f.created_at)) / 1814400.0),
             et.tag_id
      from public.event_favorites f
      join public.event_tags et on et.event_id = f.event_id
      where f.user_id = auth.uid()
      union all
      -- просмотры ×1
      select v.event_id,
             1::numeric * exp(-extract(epoch from (now() - v.viewed_at)) / 1814400.0),
             et.tag_id
      from public.event_views v
      join public.event_tags et on et.event_id = v.event_id
      where v.user_id = auth.uid()
      union all
      -- скрытия ×(−2): осаживают всю похожую тему, а не только карточку
      select h.event_id,
             -2::numeric * exp(-extract(epoch from (now() - h.hidden_at)) / 1814400.0),
             et.tag_id
      from public.event_hides h
      join public.event_tags et on et.event_id = h.event_id
      where h.user_id = auth.uid()
      union all
      -- интересы ×2 (заявленные, не затухают)
      select null::uuid, 2::numeric, pi.tag_id
      from public.profile_interests pi
      where pi.profile_id = auth.uid()
  ),
  taste as (
      select tag_id, sum(weight) as weight
      from signals
      group by tag_id
      having sum(weight) <> 0
  ),
  event_scores as (
      select et.event_id,
             sum(t.weight) as tag_score,
             count(*) filter (where t.weight > 0)::int as match_count
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
