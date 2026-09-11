"use client";

import { useMemo, useState } from "react";
import { useList } from "@refinedev/core";
import { Spinner, EmptyState } from "@/components/ui";
import type { EventRecord } from "@/components/EventCard";
import { supabaseClient } from "@/lib/supabase";

type LeaderboardRow = {
  registration_id: string;
  event_id: string;
  event_title: string;
  team_id: string | null;
  team_name: string | null;
  participant_name: string | null;
  total_score: number;
  judges_count: number;
};

type NormalizedRow = {
  registration_id: string;
  team_id: string | null;
  team_name: string | null;
  participant_name: string | null;
  raw_score: number;
  normalized_score: number;
  judges_count: number;
};

const MEDALS = ["🥇", "🥈", "🥉"];

export default function LeaderboardPage() {
  const [eventId, setEventId] = useState<string>("all");
  const [mode, setMode] = useState<"raw" | "normalized">("raw");
  const [normalized, setNormalized] = useState<NormalizedRow[]>([]);
  const [loadingNormalized, setLoadingNormalized] = useState(false);

  const eventsQuery = useList<EventRecord>({
    resource: "events",
    filters: [{ field: "status", operator: "eq", value: "published" }],
    pagination: { pageSize: 100 },
  });
  const boardQuery = useList<LeaderboardRow>({
    resource: "leaderboard",
    filters:
      eventId === "all"
        ? []
        : [{ field: "event_id", operator: "eq", value: eventId }],
    sorters: [{ field: "total_score", order: "desc" }],
    pagination: { pageSize: 200 },
  });

  const rows = useMemo(
    () =>
      (boardQuery.result.data ?? []).filter(
        (r) => r.total_score > 0 || r.team_name || r.participant_name,
      ),
    [boardQuery.result.data],
  );
  const events = eventsQuery.result.data ?? [];

  // Нормализация имеет смысл в рамках одного события
  async function loadNormalized(ev: string) {
    setLoadingNormalized(true);
    try {
      const { data } = await supabaseClient.rpc("normalized_leaderboard", {
        ev,
      });
      setNormalized((data as NormalizedRow[]) ?? []);
    } finally {
      setLoadingNormalized(false);
    }
  }

  function switchMode(next: "raw" | "normalized") {
    setMode(next);
    if (next === "normalized" && eventId !== "all") {
      loadNormalized(eventId);
    }
  }

  function onEventChange(next: string) {
    setEventId(next);
    if (mode === "normalized" && next !== "all") {
      loadNormalized(next);
    }
  }

  const showNormalized = mode === "normalized" && eventId !== "all";
  const display = showNormalized ? normalized : rows;

  return (
    <div className="container-page py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="h1">Таблица лидеров</h1>
          <p className="muted mt-1">
            Команды и участники, набравшие больше всего баллов от судей.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            className="input w-full sm:w-72"
            value={eventId}
            onChange={(e) => onEventChange(e.target.value)}
          >
            <option value="all">Все мероприятия</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
          <select
            className="input w-full sm:w-64"
            value={mode}
            onChange={(e) => switchMode(e.target.value as "raw" | "normalized")}
            title="Нормализация компенсирует строгость судей (z-score)"
          >
            <option value="raw">Обычные баллы</option>
            <option value="normalized" disabled={eventId === "all"}>
              Нормализованные (0–100)
            </option>
          </select>
        </div>
      </div>

      {showNormalized && (
        <p className="muted mt-3 rounded-xl bg-gold-100 px-4 py-2.5 text-xs font-medium text-[#92610a]">
          Нормализованный режим: баллы каждого судьи приведены к его среднему
          уровню — «строгие» и «щедрые» судьи сравниваются честно. Выберите
          конкретное мероприятие.
        </p>
      )}

      <div className="card mt-6 overflow-hidden">
        {loadingNormalized || boardQuery.query.isLoading ? (
          <Spinner />
        ) : display.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="Пока нет оценённых работ"
              description="Рейтинг появится, когда судьи оценят первые решения."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-navy-800 text-left text-white">
                  <th className="px-5 py-3.5 font-semibold">Место</th>
                  <th className="px-5 py-3.5 font-semibold">Команда / участник</th>
                  {!showNormalized && (
                    <th className="px-5 py-3.5 font-semibold">Мероприятие</th>
                  )}
                  <th className="px-5 py-3.5 text-center font-semibold">Судей</th>
                  <th className="px-5 py-3.5 text-right font-semibold">
                    {showNormalized ? "Индекс (0–100)" : "Баллы"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {display.map((row, i) => {
                  const team =
                    (row as LeaderboardRow & NormalizedRow).team_name ||
                    (row as LeaderboardRow & NormalizedRow).participant_name ||
                    "—";
                  return (
                    <tr
                      key={row.registration_id}
                      className="border-t border-slate-100 hover:bg-slate-50/70"
                    >
                      <td className="px-5 py-4 font-bold">
                        {i < 3 ? (
                          <span className="text-lg">{MEDALS[i]}</span>
                        ) : (
                          <span className="text-muted">{i + 1}</span>
                        )}
                      </td>
                      <td className="px-5 py-4 font-semibold">{team}</td>
                      {!showNormalized && (
                        <td className="px-5 py-4 text-muted">
                          {(row as LeaderboardRow).event_title}
                        </td>
                      )}
                      <td className="px-5 py-4 text-center text-muted">
                        {row.judges_count || "—"}
                      </td>
                      <td className="px-5 py-4 text-right text-base font-extrabold text-navy-800">
                        {showNormalized
                          ? (row as NormalizedRow).normalized_score
                          : (row as LeaderboardRow).total_score}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
