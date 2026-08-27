"use client";

import { useState } from "react";
import { useList } from "@refinedev/core";
import { Spinner, EmptyState } from "@/components/ui";
import type { EventRecord } from "@/components/EventCard";

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

const MEDALS = ["🥇", "🥈", "🥉"];

export default function LeaderboardPage() {
  const [eventId, setEventId] = useState<string>("all");

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

  const rows = (boardQuery.result.data ?? []).filter(
    (r) => r.total_score > 0 || r.team_name || r.participant_name,
  );
  const events = eventsQuery.result.data ?? [];

  return (
    <div className="container-page py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="h1">Таблица лидеров</h1>
          <p className="muted mt-1">
            Команды и участники, набравшие больше всего баллов от судей.
          </p>
        </div>
        <select
          className="input w-full sm:w-72"
          value={eventId}
          onChange={(e) => setEventId(e.target.value)}
        >
          <option value="all">Все мероприятия</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title}
            </option>
          ))}
        </select>
      </div>

      <div className="card mt-6 overflow-hidden">
        {boardQuery.query.isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
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
                  <th className="px-5 py-3.5 font-semibold">Мероприятие</th>
                  <th className="px-5 py-3.5 text-center font-semibold">Судей</th>
                  <th className="px-5 py-3.5 text-right font-semibold">Баллы</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
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
                    <td className="px-5 py-4 font-semibold">
                      {row.team_name || row.participant_name || "—"}
                    </td>
                    <td className="px-5 py-4 text-muted">{row.event_title}</td>
                    <td className="px-5 py-4 text-center text-muted">
                      {row.judges_count || "—"}
                    </td>
                    <td className="px-5 py-4 text-right text-base font-extrabold text-navy-800">
                      {row.total_score}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
