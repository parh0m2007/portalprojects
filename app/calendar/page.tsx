"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useList } from "@refinedev/core";
import type { EventRecord } from "@/components/EventCard";
import { FormatBadge, isRegistrationClosed } from "@/components/ui";
import { downloadIcs } from "@/lib/ics";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

export default function CalendarPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const eventsQuery = useList<EventRecord>({
    resource: "events",
    filters: [{ field: "status", operator: "eq", value: "published" }],
    pagination: { pageSize: 200 },
  });
  const events = eventsQuery.result.data ?? [];

  const byDay = useMemo(() => {
    const map = new Map<number, EventRecord[]>();
    for (const e of events) {
      if (!e.starts_at) continue;
      const d = new Date(e.starts_at);
      if (d.getFullYear() !== year || d.getMonth() !== month) continue;
      const day = d.getDate();
      const list = map.get(day) ?? [];
      list.push(e);
      map.set(day, list);
    }
    return map;
  }, [events, year, month]);

  const cells = useMemo(() => {
    const first = new Date(year, month, 1);
    const offset = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const arr: (number | null)[] = Array(offset).fill(null);
    for (let d = 1; d <= daysInMonth; d++) arr.push(d);
    while (arr.length % 7 !== 0) arr.push(null);
    return arr;
  }, [year, month]);

  const monthEvents = events.filter((e) => {
    if (!e.starts_at) return false;
    const d = new Date(e.starts_at);
    return d.getFullYear() === year && d.getMonth() === month;
  });

  function shift(delta: number) {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  }

  return (
    <div className="container-page py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="h1">Календарь событий</h1>
          <p className="muted mt-1">
            Все мероприятия по дням — можно выгрузить в Google/Apple Calendar.
          </p>
        </div>
        <button
          className="btn btn-ghost"
          onClick={() =>
            downloadIcs(monthEvents, "КейсПортал", `caseportal-${year}-${String(month + 1).padStart(2, "0")}.ics`)
          }
          disabled={monthEvents.length === 0}
        >
          ⬇ Экспорт месяца (iCal)
        </button>
      </div>

      <div className="card mt-6 p-4 md:p-6">
        <div className="mb-4 flex items-center justify-between">
          <button className="btn btn-ghost" onClick={() => shift(-1)}>
            ←
          </button>
          <p className="text-lg font-bold">
            {MONTHS[month]} {year}
          </p>
          <button className="btn btn-ghost" onClick={() => shift(1)}>
            →
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-muted">
          {WEEKDAYS.map((w) => (
            <div key={w} className="py-1">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((day, i) => {
            const dayEvents = day ? (byDay.get(day) ?? []) : [];
            const isToday =
              day === now.getDate() &&
              month === now.getMonth() &&
              year === now.getFullYear();
            return (
              <div
                key={i}
                className={`min-h-20 rounded-lg border p-1.5 text-left ${
                  day
                    ? isToday
                      ? "border-navy-800 bg-navy-50"
                      : "border-slate-100"
                    : "border-transparent"
                }`}
              >
                {day && (
                  <>
                    <p
                      className={`text-xs font-semibold ${
                        isToday ? "text-navy-800" : "text-muted"
                      }`}
                    >
                      {day}
                    </p>
                    <div className="mt-1 space-y-1">
                      {dayEvents.slice(0, 2).map((e) => (
                        <Link
                          key={e.id}
                          href={`/events/${e.id}`}
                          className={`block truncate rounded px-1.5 py-1 text-[11px] font-medium ${
                            isRegistrationClosed(e)
                              ? "bg-slate-100 text-muted"
                              : "bg-navy-800 text-white hover:bg-navy-700"
                          }`}
                          title={e.title}
                        >
                          {e.title}
                        </Link>
                      ))}
                      {dayEvents.length > 2 && (
                        <p className="px-1 text-[10px] text-muted">
                          +{dayEvents.length - 2} ещё
                        </p>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {monthEvents.length > 0 && (
        <section className="mt-8">
          <h2 className="h2 mb-4">События месяца</h2>
          <div className="grid gap-3">
            {monthEvents.map((e) => (
              <Link
                key={e.id}
                href={`/events/${e.id}`}
                className="card flex items-center justify-between gap-4 p-4 transition hover:shadow"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold">{e.title}</p>
                  <p className="muted mt-0.5 text-xs">
                    {formatDay(e.starts_at)}
                    {e.place ? ` · ${e.place}` : ""}
                  </p>
                </div>
                <FormatBadge format={e.format} />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function formatDay(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}
