"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useList, useUpdate, useGetIdentity } from "@refinedev/core";
import type { Identity } from "@/lib/auth";
import type { EventRecord } from "@/components/EventCard";
import {
  EmptyState,
  Spinner,
  StatusBadge,
  formatDate,
} from "@/components/ui";
import { Guard } from "@/components/Guard";

type EventJudge = {
  id: string;
  event_id: string;
  user_id: string;
  status: string;
  created_at: string;
};

type SolutionCard = {
  id: string;
  registration_id: string;
  title: string;
  description: string;
  file_path: string | null;
  status: string;
  event_id: string;
  event_title: string;
  team_name: string | null;
  case_title: string | null;
  blind_judging: boolean;
  total_score: number;
  judges_count: number;
};

function JudgePanel() {
  const { data: identity } = useGetIdentity<Identity | null>();
  const { mutate: respond } = useUpdate();

  const invitationsQuery = useList<EventJudge>({
    resource: "event_judges",
    filters: [{ field: "user_id", operator: "eq", value: identity?.id ?? "" }],
    sorters: [{ field: "created_at", order: "desc" }],
    pagination: { pageSize: 100 },
    queryOptions: { enabled: !!identity?.id },
  });
  const eventsQuery = useList<EventRecord>({
    resource: "events",
    pagination: { pageSize: 200 },
  });

  const judges = useMemo(
    () => invitationsQuery.result.data ?? [],
    [invitationsQuery.result.data],
  );
  const events = new Map(
    (eventsQuery.result.data ?? []).map((e) => [e.id, e]),
  );

  const acceptedEventIds = useMemo(
    () =>
      judges
        .filter((j) => j.status === "accepted")
        .map((j) => j.event_id),
    [judges],
  );

  const queueQuery = useList<SolutionCard>({
    resource: "judge_work_cards",
    filters: [
      { field: "event_id", operator: "in", value: acceptedEventIds },
    ],
    sorters: [{ field: "created_at", order: "desc" }],
    pagination: { pageSize: 200 },
    queryOptions: { enabled: acceptedEventIds.length > 0 },
  });

  const pending = judges.filter((j) => j.status === "pending");

  return (
    <div className="container-page py-10">
      <h1 className="h1">Судейство</h1>
      <p className="muted mt-1">
        Приглашения в жюри и работы команд, ожидающие оценки.
      </p>

      {/* Invitations */}
      <section className="mt-8">
        <h2 className="h2 mb-4">Приглашения</h2>
        {invitationsQuery.query.isLoading ? (
          <Spinner />
        ) : pending.length === 0 ? (
          <div className="card p-5 muted">Новых приглашений нет.</div>
        ) : (
          <div className="grid gap-3">
            {pending.map((inv) => {
              const event = events.get(inv.event_id);
              return (
                <div
                  key={inv.id}
                  className="card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-bold">
                      {event?.title ?? "Мероприятие"}
                    </p>
                    <p className="muted mt-0.5">
                      {event ? formatDate(event.starts_at) : ""}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="btn btn-success"
                      onClick={() =>
                        respond({
                          resource: "event_judges",
                          id: inv.id,
                          values: { status: "accepted" },
                        })
                      }
                    >
                      Принять — стать судьёй
                    </button>
                    <button
                      className="btn btn-danger"
                      onClick={() =>
                        respond({
                          resource: "event_judges",
                          id: inv.id,
                          values: { status: "declined" },
                        })
                      }
                    >
                      Отклонить
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Judge events */}
      {acceptedEventIds.length > 0 && (
        <section className="mt-10">
          <h2 className="h2 mb-1">Работы на оценку</h2>
          <p className="muted mb-4">
            Решения команд по мероприятиям, где вы судья. Откройте работу,
            выставьте баллы по критериям — рейтинг обновится автоматически.
          </p>

          {queueQuery.query.isLoading ? (
            <Spinner />
          ) : (queueQuery.result.data ?? []).length === 0 ? (
            <div className="card p-6 muted">
              Команды ещё не загрузили решения по вашим мероприятиям.
            </div>
          ) : (
            <div className="grid gap-4">
              {(queueQuery.result.data ?? []).map((sol) => (
                <div
                  key={sol.id}
                  className="card flex flex-col gap-4 p-5 md:flex-row md:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <p className="muted text-xs font-semibold uppercase tracking-wide">
                      {sol.event_title}
                      {sol.case_title ? ` · ${sol.case_title}` : ""}
                    </p>
                    <h3 className="mt-1 font-bold">{sol.title}</h3>
                    <p className="muted mt-0.5">
                      {sol.team_name === null
                        ? "Авторство скрыто (слепое судейство)"
                        : sol.team_name || "Без команды"}
                      {sol.description ? ` — ${sol.description}` : ""}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-extrabold text-navy-800">
                      {sol.total_score}
                    </p>
                    <p className="text-xs text-muted">
                      баллов · {sol.judges_count} судь
                      {sol.judges_count === 1 ? "я" : "ей"}
                    </p>
                  </div>
                  <Link
                    href={`/judge/review/${sol.id}`}
                    className="btn btn-primary md:w-36"
                  >
                    Оценить работу
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* History */}
      {judges.some((j) => j.status === "declined") && (
        <section className="mt-10">
          <h2 className="h2 mb-4">История приглашений</h2>
          <div className="grid gap-3">
            {judges
              .filter((j) => j.status === "declined")
              .map((inv) => (
                <div
                  key={inv.id}
                  className="card flex items-center justify-between p-4"
                >
                  <span className="font-semibold">
                    {events.get(inv.event_id)?.title ?? "Мероприятие"}
                  </span>
                  <StatusBadge status={inv.status} />
                </div>
              ))}
          </div>
        </section>
      )}

      {judges.length === 0 && acceptedEventIds.length === 0 && (
        <div className="mt-8">
          <EmptyState
            title="Вы пока не судья"
            description="Организатор мероприятия должен добавить вас по e-mail — приглашение появится здесь."
          />
        </div>
      )}
    </div>
  );
}

export default function JudgePage() {
  return (
    <Guard>
      <JudgePanel />
    </Guard>
  );
}
