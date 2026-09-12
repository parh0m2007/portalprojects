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
