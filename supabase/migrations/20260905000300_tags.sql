-- ============================================================
-- КейсПортал — миграция: теги, интересы, сигналы (Фаза 1 ML)
-- Запустить в SQL Editor. Идемпотентно.
-- ============================================================

-- ---------- Теги ----------
create table if not exists public.tags (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  emoji      text not null default '',
  sort_order int  not null default 0
);

-- Теги мероприятий
create table if not exists public.event_tags (
  event_id uuid not null references public.events(id) on delete cascade,
  tag_id   uuid not null references public.tags(id) on delete cascade,
  primary key (event_id, tag_id)
);

-- Интересы пользователя
create table if not exists public.profile_interests (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tag_id     uuid not null references public.tags(id) on delete cascade,
  primary key (profile_id, tag_id)
);

-- Сигналы: просмотры карточек
create table if not exists public.event_views (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references public.profiles(id) on delete cascade,
  event_id  uuid not null references public.events(id) on delete cascade,
  viewed_at timestamptz not null default now()
);
create index if not exists event_views_user_idx  on public.event_views(user_id);
create index if not exists event_views_event_idx on public.event_views(event_id);

-- Сигналы: «не интересно»
create table if not exists public.event_hides (
  user_id   uuid not null references public.profiles(id) on delete cascade,
  event_id  uuid not null references public.events(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

-- ---------- RLS ----------
alter table public.tags              enable row level security;
alter table public.event_tags        enable row level security;
alter table public.profile_interests enable row level security;
alter table public.event_views       enable row level security;
alter table public.event_hides       enable row level security;

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

-- ---------- Демо-теги ----------
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

-- Теги демо-мероприятий
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
