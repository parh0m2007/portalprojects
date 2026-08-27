"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useList } from "@refinedev/core";
import type { EventRecord } from "@/components/EventCard";
import { COVERS_BUCKET, publicFileUrl } from "@/lib/supabase";
import { CoverPlaceholder, EmptyState, Spinner } from "@/components/ui";

type SolutionCard = {
  id: string;
  title: string;
  description: string;
  event_id: string;
  event_title: string;
  team_name: string | null;
  case_title: string | null;
  total_score: number;
  judges_count: number;
  results_published_at: string | null;
};

const MEDALS = ["🥇", "🥈", "🥉"];

export default function WorksPage() {
  const [search, setSearch] = useState("");

  const eventsQuery = useList<EventRecord>({
    resource: "events",
    pagination: { pageSize: 200 },
  });
  const solutionsQuery = useList<SolutionCard>({
    resource: "solution_cards",
    sorters: [{ field: "total_score", order: "desc" }],
    pagination: { pageSize: 200 },
  });

  const publishedEventIds = useMemo(
    () =>
      new Set(
        (eventsQuery.result.data ?? [])
          .filter((e) => e.results_published_at)
          .map((e) => e.id),
      ),
    [eventsQuery.result.data],
  );

  const works = useMemo(() => {
    const all = (solutionsQuery.result.data ?? []).filter((s) =>
      publishedEventIds.has(s.event_id),
    );
    const sorted = [...all].sort((a, b) => b.total_score - a.total_score);
    const counter = new Map<string, number>();
    const places = new Map<string, number>();
    for (const s of sorted) {
      const next = (counter.get(s.event_id) ?? 0) + 1;
      counter.set(s.event_id, next);
      places.set(s.id, next);
    }
    return { sorted, places };
  }, [solutionsQuery.result.data, publishedEventIds]);

  const filtered = works.sorted.filter((w) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      w.title.toLowerCase().includes(q) ||
      (w.team_name ?? "").toLowerCase().includes(q) ||
      w.event_title.toLowerCase().includes(q)
    );
  });

  const eventCover = (eventId: string) => {
    const ev = (eventsQuery.result.data ?? []).find((e) => e.id === eventId);
    return publicFileUrl(COVERS_BUCKET, ev?.cover_path);
  };

  return (
    <div className="container-page py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="h1">Работы участников</h1>
          <p className="muted mt-1">
            Решения команд с опубликованными итогами — оценки жюри открыты.
          </p>
        </div>
        <input
          className="input w-full sm:w-80"
          placeholder="Поиск по названию, команде или событию"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {solutionsQuery.query.isLoading || eventsQuery.query.isLoading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title={search ? "Ничего не найдено" : "Опубликованных работ пока нет"}
            description={
              search
                ? "Попробуйте изменить запрос."
                : "Работы появятся здесь после того, как организатор опубликует итоги мероприятия."
            }
          />
        </div>
      ) : (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((w) => {
            const place = works.places.get(w.id) ?? 0;
            return (
              <Link
                key={w.id}
                href={`/works/${w.id}`}
                className="card overflow-hidden transition hover:-translate-y-0.5 hover:shadow-lg"
              >
                <div className="relative">
                  {eventCover(w.event_id) ? (
                    <img
                      src={eventCover(w.event_id)!}
                      alt={w.title}
                      className="h-36 w-full object-cover"
                    />
                  ) : (
                    <CoverPlaceholder seed={w.id} className="h-36" />
                  )}
                  {place > 0 && place <= 3 && (
                    <span className="badge absolute left-3 top-3 bg-gold-500 text-navy-950">
                      {MEDALS[place - 1]} {place} место
                    </span>
                  )}
                </div>
                <div className="p-5">
                  <h3 className="font-bold leading-snug">{w.title}</h3>
                  <p className="muted mt-1">
                    {w.team_name || "Без команды"}
                    {w.case_title ? ` · ${w.case_title}` : ""}
                  </p>
                  <p className="muted mt-0.5 text-xs">{w.event_title}</p>
                  <div className="mt-3 flex items-center justify-between text-xs text-muted">
                    <span>
                      ⭐ {w.total_score} балл{w.total_score === 1 ? "" : "ов"}
                    </span>
                    <span>{w.judges_count} судь{w.judges_count === 1 ? "я" : "ей"}</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
