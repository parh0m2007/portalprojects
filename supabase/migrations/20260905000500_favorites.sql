-- ============================================================
-- КейсПортал — миграция: избранное (сигнал для умной ленты)
-- Запустить в SQL Editor. Идемпотентно.
-- ============================================================

create table if not exists public.event_favorites (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  event_id   uuid not null references public.events(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

create index if not exists event_favorites_user_idx on public.event_favorites(user_id);

alter table public.event_favorites enable row level security;

drop policy if exists "favorites: свои" on public.event_favorites;
create policy "favorites: свои"
  on public.event_favorites for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
