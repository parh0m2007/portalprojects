-- ============================================================
-- КейсПортал — Мультиарендность (организации, роли, приглашения)
--  - organizations: рабочие пространства организаторов
--  - organization_members: роли owner / admin / manager
--  - events.organization_id: событие принадлежит организации
--  - RPC: create_organization, invite_to_organization,
--         accept_organization_invite, leave_organization,
--         transfer_event_to_organization, my_organizations
-- Запустить в SQL Editor (после schema.sql). Идемпотентно.
-- ============================================================

-- ---------- Организации ----------
create table if not exists public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  logo_path  text,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- slug: только строчные латиница/цифры/дефис
alter table public.organizations
  drop constraint if exists organizations_slug_check;
alter table public.organizations
  add constraint organizations_slug_check
  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- ---------- Участники и роли ----------
create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  -- owner — владелец (один), admin — полный доступ, manager — создание/ведение событий
  role            text not null default 'manager' check (role in ('owner', 'admin', 'manager')),
  created_at      timestamptz not null default now(),
  primary key (organization_id, user_id)
);

-- ---------- Приглашения в организацию ----------
create table if not exists public.organization_invites (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  email      text not null,
  role       text not null default 'manager' check (role in ('admin', 'manager')),
  token      text not null unique default encode(gen_random_bytes(16), 'hex'),
  invited_by uuid not null references public.profiles(id),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists organization_invites_org_idx   on public.organization_invites(org_id);
create index if not exists organization_invites_email_idx on public.organization_invites(email);

-- ---------- Событие принадлежит организации ----------
alter table public.events add column if not exists organization_id
  uuid references public.organizations(id) on delete set null;

create index if not exists events_organization_idx on public.events(organization_id);

alter table public.organizations    enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_invites  enable row level security;

-- ---------- Хелперы ----------
-- Роль пользователя в организации (null — не состоит)
create or replace function public.org_role(org uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select role from public.organization_members
  where organization_id = org and user_id = auth.uid();
$$;

-- Пользователь управляет организацией (owner/admin)
create or replace function public.is_org_manager(org uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.org_role(org) in ('owner', 'admin');
$$;

-- Пользователь может вести события организации (owner/admin/manager)
create or replace function public.is_org_member(org uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.org_role(org) is not null;
$$;

-- Управление событием: автор ИЛИ член организации-владельца
create or replace function public.can_manage_event(ev uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.events e
    where e.id = ev
      and (
        e.author_id = auth.uid()
        or (e.organization_id is not null and public.is_org_member(e.organization_id))
      )
  );
$$;

grant execute on function public.org_role(uuid)            to authenticated;
grant execute on function public.is_org_manager(uuid)       to authenticated;
grant execute on function public.is_org_member(uuid)        to authenticated;
grant execute on function public.can_manage_event(uuid)     to authenticated;

-- ---------- RLS ----------
drop policy if exists "organizations: видны членам" on public.organizations;
create policy "organizations: видны членам"
  on public.organizations for select to authenticated
  using (public.is_org_member(id));
drop policy if exists "organizations: создаёт основатель" on public.organizations;
create policy "organizations: создаёт основатель"
  on public.organizations for insert to authenticated
  with check (created_by = auth.uid());
drop policy if exists "organizations: управляют owner/admin" on public.organizations;
create policy "organizations: управляют owner/admin"
  on public.organizations for update to authenticated
  using (public.is_org_manager(id))
  with check (public.is_org_manager(id));
drop policy if exists "organizations: удаляет owner" on public.organizations;
create policy "organizations: удаляет owner"
  on public.organizations for delete to authenticated
  using (public.org_role(id) = 'owner');

drop policy if exists "org_members: видят члены организации" on public.organization_members;
create policy "org_members: видят члены организации"
  on public.organization_members for select to authenticated
  using (
    public.is_org_member(organization_id)
    or exists (
      select 1 from public.organization_invites i
      where i.org_id = organization_members.organization_id
        and i.email = auth.jwt() ->> 'email'
        and i.accepted_at is null
    )
  );
drop policy if exists "org_members: добавляет owner/admin" on public.organization_members;
create policy "org_members: добавляет owner/admin"
  on public.organization_members for insert to authenticated
  with check (public.is_org_manager(organization_id));
drop policy if exists "org_members: удаляет owner/admin (не owner-запись)" on public.organization_members;
create policy "org_members: удаляет owner/admin (не owner-запись)"
  on public.organization_members for delete to authenticated
  using (
    public.is_org_manager(organization_id) and role <> 'owner'
  );

drop policy if exists "org_invites: видят организаторы" on public.organization_invites;
create policy "org_invites: видят организаторы"
  on public.organization_invites for select to authenticated
  using (public.is_org_manager(org_id));
drop policy if exists "org_invites: создаёт owner/admin" on public.organization_invites;
create policy "org_invites: создаёт owner/admin"
  on public.organization_invites for insert to authenticated
  with check (public.is_org_manager(org_id));
drop policy if exists "org_invites: удаляет owner/admin" on public.organization_invites;
create policy "org_invites: удаляет owner/admin"
  on public.organization_invites for delete to authenticated
  using (public.is_org_manager(org_id));

-- ---------- events: доступ членов организации ----------
drop policy if exists "events: автор создаёт" on public.events;
create policy "events: автор создаёт"
  on public.events for insert to authenticated
  with check (
    author_id = auth.uid()
    and (
      organization_id is null
      or public.is_org_member(organization_id)
    )
  );

drop policy if exists "events: опубликованные публичны" on public.events;
create policy "events: опубликованные публичны"
  on public.events for select
  using (
    status = 'published'
    or author_id = auth.uid()
    or (organization_id is not null and public.is_org_member(organization_id))
  );

drop policy if exists "events: автор изменяет" on public.events;
create policy "events: автор изменяет"
  on public.events for update to authenticated
  using (public.can_manage_event(id))
  with check (public.can_manage_event(id));

drop policy if exists "events: автор удаляет" on public.events;
create policy "events: автор удаляет"
  on public.events for delete to authenticated
  using (public.can_manage_event(id));

-- cases / criteria / event_tags: управление — автор ИЛИ член организации
drop policy if exists "cases: управляет автор" on public.cases;
create policy "cases: управляет автор"
  on public.cases for all to authenticated
  using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));

drop policy if exists "criteria: управляет автор" on public.criteria;
create policy "criteria: управляет автор"
  on public.criteria for all to authenticated
  using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));

drop policy if exists "event_tags: управляет автор" on public.event_tags;
create policy "event_tags: управляет автор"
  on public.event_tags for all to authenticated
  using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));

-- registrations: организатор = автор или член организации
drop policy if exists "registrations: автор управляет статусом" on public.registrations;
create policy "registrations: автор управляет статусом"
  on public.registrations for update to authenticated
  using (public.can_manage_event(event_id));

-- event_judges: назначает автор или член организации
drop policy if exists "judges: автор назначает" on public.event_judges;
create policy "judges: автор назначает"
  on public.event_judges for insert to authenticated
  with check (public.can_manage_event(event_id));
drop policy if exists "judges: приглашённый отвечает / автор меняет" on public.event_judges;
create policy "judges: приглашённый отвечает / автор меняет"
  on public.event_judges for update to authenticated
  using (user_id = auth.uid() or public.can_manage_event(event_id));
drop policy if exists "judges: автор отзывает" on public.event_judges;
create policy "judges: автор отзывает"
  on public.event_judges for delete to authenticated
  using (public.can_manage_event(event_id));

-- ============================================================
-- RPC
-- ============================================================

-- Создать организацию (создатель становится owner)
create or replace function public.create_organization(name text, slug text)
returns public.organizations
language plpgsql security definer set search_path = public
as $$
declare
  org public.organizations;
begin
  if slug is null or slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'slug: только строчные латиница, цифры и дефисы';
  end if;
  insert into public.organizations (name, slug, created_by)
    values (name, slug, auth.uid())
    returning * into org;
  insert into public.organization_members (organization_id, user_id, role)
    values (org.id, auth.uid(), 'owner');
  return org;
end;
$$;
grant execute on function public.create_organization(text, text) to authenticated;

-- Пригласить пользователя по e-mail (owner/admin)
create or replace function public.invite_to_organization(
  org uuid,
  invitee_email text,
  new_role text default 'manager'
)
returns public.organization_invites
language plpgsql security definer set search_path = public
as $$
declare
  invite public.organization_invites;
  existing_user uuid;
begin
  if not public.is_org_manager(org) then
    raise exception 'Приглашать может только владелец или администратор';
  end if;
  if new_role not in ('admin', 'manager') then
    raise exception 'Роль приглашения: admin или manager';
  end if;
  if invitee_email is null or position('@' in invitee_email) = 0 then
    raise exception 'Некорректный e-mail';
  end if;

  -- если пользователь уже в организации — отказ
  select p.id into existing_user
  from public.profiles p
  where lower(p.email) = lower(invitee_email);
  if existing_user is not null and exists (
    select 1 from public.organization_members m
    where m.organization_id = org and m.user_id = existing_user
  ) then
    raise exception 'Пользователь уже состоит в организации';
  end if;

  insert into public.organization_invites (org_id, email, role, invited_by)
    values (org, lower(invitee_email), new_role, auth.uid())
    returning * into invite;
  return invite;
end;
$$;
grant execute on function public.invite_to_organization(uuid, text, text) to authenticated;

-- Принять приглашение (по токену; e-mail должен совпадать с аккаунтом)
create or replace function public.accept_organization_invite(invite_token text)
returns public.organizations
language plpgsql security definer set search_path = public
as $$
declare
  invite public.organization_invites;
  org public.organizations;
begin
  select * into invite from public.organization_invites
  where token = invite_token and accepted_at is null;
  if invite is null then
    raise exception 'Приглашение не найдено или уже принято';
  end if;
  if lower(invite.email) <> lower(auth.jwt() ->> 'email') then
    raise exception 'Приглашение отправлено на другой e-mail';
  end if;

  insert into public.organization_members (organization_id, user_id, role)
    values (invite.org_id, auth.uid(), invite.role);
  update public.organization_invites
    set accepted_at = now()
    where id = invite.id;
  select * into org from public.organizations where id = invite.org_id;
  return org;
end;
$$;
grant execute on function public.accept_organization_invite(text) to authenticated;

-- Выйти из организации (owner не может покинуть — только передать/удалить)
create or replace function public.leave_organization(org uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if public.org_role(org) = 'owner' then
    raise exception 'Владелец не может покинуть организацию — передайте владение или удалите её';
  end if;
  delete from public.organization_members
  where organization_id = org and user_id = auth.uid();
end;
$$;
grant execute on function public.leave_organization(uuid) to authenticated;

-- Передать владение (только owner)
create or replace function public.transfer_organization_ownership(org uuid, new_owner uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if public.org_role(org) <> 'owner' then
    raise exception 'Передать владение может только владелец';
  end if;
  if not exists (
    select 1 from public.organization_members
    where organization_id = org and user_id = new_owner
  ) then
    raise exception 'Новый владелец должен состоять в организации';
  end if;

  update public.organization_members set role = 'admin'
  where organization_id = org and role = 'owner';
  update public.organization_members set role = 'owner'
  where organization_id = org and user_id = new_owner;
end;
$$;
grant execute on function public.transfer_organization_ownership(uuid, uuid) to authenticated;

-- Перенести своё событие в организацию (автор, состоящий в ней)
create or replace function public.transfer_event_to_organization(ev uuid, org uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.events where id = ev and author_id = auth.uid()) then
    raise exception 'Перенести может только автор события';
  end if;
  if not public.is_org_member(org) then
    raise exception 'Вы не состоите в этой организации';
  end if;
  update public.events set organization_id = org where id = ev;
end;
$$;
grant execute on function public.transfer_event_to_organization(uuid, uuid) to authenticated;

-- Мои организации (со статистикой)
create or replace function public.my_organizations()
returns table (
  id uuid,
  name text,
  slug text,
  role text,
  members_count bigint,
  events_count bigint
)
language sql stable security definer set search_path = public
as $$
  select
    o.id,
    o.name,
    o.slug,
    m.role,
    (select count(*) from public.organization_members m2 where m2.organization_id = o.id) as members_count,
    (select count(*) from public.events e where e.organization_id = o.id) as events_count
  from public.organizations o
  join public.organization_members m on m.organization_id = o.id
  where m.user_id = auth.uid();
$$;
grant execute on function public.my_organizations() to authenticated;
