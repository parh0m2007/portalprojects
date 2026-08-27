"use client";

import Link from "next/link";
import { useState } from "react";
import { useList, useGetIdentity, useNotification } from "@refinedev/core";
import { supabaseClient } from "@/lib/supabase";
import type { Identity } from "@/lib/auth";
import type { EventRecord } from "@/components/EventCard";
import { EmptyState, FormatBadge, Spinner, formatDate } from "@/components/ui";
import { Guard } from "@/components/Guard";

type EventStats = {
  event_id: string;
  participants_count: number;
  solutions_count: number;
};

function MyEvents() {
  const { data: identity } = useGetIdentity<Identity | null>();
  const { open } = useNotification();
  const [embBusy, setEmbBusy] = useState(false);
  const [embProgress, setEmbProgress] = useState({ done: 0, total: 0 });
  const eventsQuery = useList<EventRecord>({
    resource: "events",
    filters: [
      { field: "author_id", operator: "eq", value: identity?.id ?? "" },
    ],
    sorters: [{ field: "created_at", order: "desc" }],
    pagination: { pageSize: 60 },
    queryOptions: { enabled: !!identity?.id },
  });
  const statsQuery = useList<EventStats>({
    resource: "event_stats",
    pagination: { pageSize: 200 },
  });

  const events = eventsQuery.result.data ?? [];
  const statsMap = new Map(
    (statsQuery.result.data ?? []).map((s) => [s.event_id, s]),
  );

  async function backfillEmbeddings() {
    if (!events.length) return;
    const pending = events.filter((e) => !e.embedding);
    if (pending.length === 0) {
      open?.({
        type: "success",
        message: "Все события уже с эмбеддингами",
      });
      return;
    }
    setEmbBusy(true);
    setEmbProgress({ done: 0, total: pending.length });
    let updated = 0;
    let failed = 0;
    try {
      for (const e of pending) {
        try {
          const res = await fetch("/api/embed", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: `${e.title}\n${e.description}` }),
            signal: AbortSignal.timeout(150000),
          });
          if (!res.ok) {
            failed++;
            setEmbProgress((p) => ({ ...p, done: p.done + 1 }));
            continue;
          }
          const { embedding, error } = await res.json();
          if (!Array.isArray(embedding)) {
            failed++;
            setEmbProgress((p) => ({ ...p, done: p.done + 1 }));
            if (error) {
              open?.({ type: "error", message: "Эмбеддинг не удался", description: error });
              break;
            }
            continue;
          }
          const { error: dbErr } = await supabaseClient
            .from("events")
            .update({ embedding })
            .eq("id", e.id);
          if (dbErr) failed++;
          else updated++;
          setEmbProgress((p) => ({ ...p, done: p.done + 1 }));
        } catch {
          failed++;
          setEmbProgress((p) => ({ ...p, done: p.done + 1 }));
        }
      }
      open?.({
        type: failed && !updated ? "error" : "success",
        message: `Эмбеддинги: обновлено ${updated}`,
        description: failed ? `Не удалось: ${failed}` : undefined,
      });
      eventsQuery.query.refetch().catch(() => {});
    } finally {
      setEmbBusy(false);
      setEmbProgress({ done: 0, total: 0 });
    }
  }

  return (
    <div className="container-page py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="h1">Мои мероприятия</h1>
            <p className="muted mt-1">
              Статистика записавшихся, решений и судей по каждому событию.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn btn-ghost"
              onClick={backfillEmbeddings}
              disabled={embBusy || events.length === 0}
              title="Считает нейро-вектора для событий без эмбеддингов"
            >
              {embBusy
                ? `Считаем ${embProgress.done}/${embProgress.total}…`
                : "🧠 Обновить эмбеддинги"}
            </button>
            <Link href="/my/events/new" className="btn btn-accent">
              + Создать мероприятие
            </Link>
          </div>
        </div>

      <div className="mt-8">
        {eventsQuery.query.isLoading ? (
          <Spinner />
        ) : events.length === 0 ? (
          <EmptyState
            title="Вы ещё не создавали мероприятия"
            description="Создайте кейс-чемпионат или лекцию — портал сам откроет приём заявок и позволит назначить судей."
            actionHref="/my/events/new"
            actionLabel="Создать мероприятие"
          />
        ) : (
          <div className="grid gap-4">
            {events.map((event) => {
              const stats = statsMap.get(event.id);
              return (
                <div
                  key={event.id}
                  className="card flex flex-col gap-4 p-5 md:flex-row md:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <FormatBadge format={event.format} />
                      {event.status !== "published" && (
                        <span className="badge badge-gray">
                          {event.status === "draft" ? "Черновик" : "Завершено"}
                        </span>
                      )}
                    </div>
                    <h3 className="mt-2 truncate font-bold">{event.title}</h3>
                    <p className="muted mt-0.5">
                      {formatDate(event.starts_at)}
                      {event.place ? ` · ${event.place}` : ""}
                    </p>
                  </div>

                  <div className="flex gap-6 text-center">
                    <div>
                      <p className="text-xl font-extrabold">
                        {stats?.participants_count ?? 0}
                      </p>
                      <p className="text-xs text-muted">заявок</p>
                    </div>
                    <div>
                      <p className="text-xl font-extrabold">
                        {stats?.solutions_count ?? 0}
                      </p>
                      <p className="text-xs text-muted">решений</p>
                    </div>
                  </div>

                  <Link
                    href={`/my/events/${event.id}`}
                    className="btn btn-primary md:w-44"
                  >
                    Статистика и судьи
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function MyPage() {
  return (
    <Guard>
      <MyEvents />
    </Guard>
  );
}
