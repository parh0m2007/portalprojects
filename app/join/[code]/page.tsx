"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useList, useGetIdentity, useNotification } from "@refinedev/core";
import { supabaseClient } from "@/lib/supabase";
import type { Identity } from "@/lib/auth";
import type { EventRecord } from "@/components/EventCard";
import { EmptyState, Spinner, formatDate } from "@/components/ui";
import { Guard } from "@/components/Guard";

type Team = { id: string; name: string; captain_id: string | null; invite_code: string };
type Registration = {
  id: string;
  event_id: string;
  team_id: string;
  case_id: string | null;
  status: string;
};
type Profile = { id: string; full_name: string };
type TeamMember = { team_id: string; user_id: string };

function JoinTeam() {
  const { code } = useParams<{ code: string }>();
  const { data: identity } = useGetIdentity<Identity | null>();
  const { open } = useNotification();
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);

  const teamsQuery = useList<Team>({
    resource: "teams",
    filters: [{ field: "invite_code", operator: "eq", value: code as string }],
    pagination: { pageSize: 1 },
    queryOptions: { enabled: !!identity?.id },
  });
  const team = teamsQuery.result.data?.[0];

  const regsQuery = useList<Registration>({
    resource: "registrations",
    filters: [{ field: "team_id", operator: "eq", value: team?.id ?? "" }],
    pagination: { pageSize: 1 },
    queryOptions: { enabled: !!team?.id },
  });
  const reg = regsQuery.result.data?.[0];

  const eventQuery = useList<EventRecord>({
    resource: "events",
    filters: [{ field: "id", operator: "eq", value: reg?.event_id ?? "" }],
    pagination: { pageSize: 1 },
    queryOptions: { enabled: !!reg?.event_id },
  });
  const event = eventQuery.result.data?.[0];
  const profilesQuery = useList<Profile>({
    resource: "profiles",
    pagination: { pageSize: 500 },
  });
  const membersQuery = useList<TeamMember>({
    resource: "team_members",
    filters: [{ field: "team_id", operator: "eq", value: team?.id ?? "" }],
    pagination: { pageSize: 50 },
    queryOptions: { enabled: !!team?.id },
  });

  if (!identity)
    return (
      <div className="container-page max-w-lg py-16">
        <EmptyState
          title="Войдите, чтобы присоединиться к команде"
          description="Приглашение в команду доступно пользователям портала."
          actionHref="/login"
          actionLabel="Войти"
        />
      </div>
    );

  if (teamsQuery.query.isLoading || (team && regsQuery.query.isLoading))
    return <Spinner />;

  if (!team)
    return (
      <div className="container-page max-w-lg py-16">
        <EmptyState
          title="Приглашение не найдено"
          description="Проверьте ссылку — возможно, код устарел или введён с ошибкой."
          actionHref="/"
          actionLabel="На главную"
        />
      </div>
    );

  const captain = (profilesQuery.result.data ?? []).find(
    (p) => p.id === team.captain_id,
  );
  const members = (membersQuery.result.data ?? [])
    .map((m) => profilesQuery.result.data?.find((p) => p.id === m.user_id))
    .filter((p): p is Profile => !!p);
  const alreadyMember =
    !!identity &&
    (membersQuery.result.data ?? []).some((m) => m.user_id === identity.id);
  const alreadyRegistered = (myRegsCheck: string[]) =>
    myRegsCheck.includes(reg?.event_id ?? "");

  async function join() {
    if (!team || !identity || !reg) return;
    setJoining(true);
    try {
      if (!alreadyMember) {
        const { error: tmErr } = await supabaseClient
          .from("team_members")
          .insert({ team_id: team.id, user_id: identity.id });
        if (tmErr) throw tmErr;
      }
      // участник присоединяется и к событию (если ещё не записан)
      const { data: myRegs } = await supabaseClient
        .from("registrations")
        .select("event_id")
        .eq("user_id", identity.id);
      if (!(myRegs ?? []).some((r) => r.event_id === reg.event_id)) {
        const { error: regErr } = await supabaseClient
          .from("registrations")
          .insert({
            event_id: reg.event_id,
            user_id: identity.id,
            team_id: team.id,
            case_id: reg.case_id,
            status: "pending",
          });
        if (regErr && !regErr.message.includes("duplicate")) throw regErr;
      }
      setJoined(true);
      open?.({
        type: "success",
        message: "Вы в команде!",
        description: `Команда «${team.name}» ждёт подтверждения заявки организатором.`,
      });
    } catch (err) {
      open?.({
        type: "error",
        message: "Не удалось присоединиться",
        description: (err as { message?: string })?.message,
      });
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="container-page max-w-lg py-14">
      <div className="card p-6 md:p-8 text-center">
        <span className="badge badge-navy">Приглашение в команду</span>
        <h1 className="mt-4 text-2xl font-extrabold">«{team.name}»</h1>
        <p className="muted mt-1">
          Капитан: {captain?.full_name || "—"}
          {reg && event ? ` · ${event.title}` : ""}
        </p>
        {reg && event && (
          <p className="muted mt-0.5 text-xs">{formatDate(event.starts_at)}</p>
        )}

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {members.map((m) => (
            <span key={m.id} className="badge badge-gray">
              {m.full_name || "Участник"}
            </span>
          ))}
          {members.length === 0 && (
            <span className="muted text-sm">Пока только капитан</span>
          )}
        </div>

        {joined || alreadyMember ? (
          <div className="mt-6 space-y-3">
            <p className="rounded-xl bg-green-50 px-4 py-3 text-sm font-semibold text-green-700">
              ✓ Вы уже в команде
            </p>
            <Link href="/my/registrations" className="btn btn-primary w-full">
              Мои регистрации
            </Link>
          </div>
        ) : (
          <button
            className="btn btn-accent mt-6 w-full"
            onClick={join}
            disabled={joining}
          >
            {joining ? "Присоединяемся…" : "Присоединиться к команде"}
          </button>
        )}

        {alreadyRegistered([]) && null}
      </div>
      <p className="muted mt-4 text-center text-xs">
        Код приглашения: <b>{team.invite_code}</b>
      </p>
    </div>
  );
}

// маленькая обёртка, чтобы не тянуть useOne до загрузки team
function useEventTitle(eventId?: string) {
  const query = useList<EventRecord>({
    resource: "events",
    filters: [{ field: "id", operator: "eq", value: eventId ?? "" }],
    pagination: { pageSize: 1 },
    queryOptions: { enabled: !!eventId },
  });
  return query.result.data?.[0];
}

export default function JoinPage() {
  return (
    <Guard>
      <JoinTeam />
    </Guard>
  );
}
