"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useOne, useList, useGetIdentity } from "@refinedev/core";
import { supabaseClient } from "@/lib/supabase";
import type { Identity } from "@/lib/auth";
import type { EventRecord } from "@/components/EventCard";
import { COVERS_BUCKET, publicFileUrl } from "@/lib/supabase";
import {
  CoverPlaceholder,
  EmptyState,
  FormatBadge,
  Spinner,
  formatDate,
  isRegistrationClosed,
} from "@/components/ui";

type CaseRecord = {
  id: string;
  event_id: string;
  title: string;
  description: string;
};

type EventStats = {
  event_id: string;
  participants_count: number;
  approved_count: number;
  waitlist_count: number;
  capacity: number | null;
  seats_left: number | null;
  solutions_count: number;
};

type Organizer = { id: string; full_name: string; bio: string };

type LeaderboardRow = {
  registration_id: string;
  team_id: string | null;
  team_name: string | null;
  participant_name: string | null;
  total_score: number;
};

type CoRow = { event_id: string; related_id: string; strength: number };
type SimilarRow = {
  id: string;
  title: string;
  place: string;
  starts_at: string | null;
  similarity: number;
};

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: identity } = useGetIdentity<Identity | null>();
  const [similar, setSimilar] = useState<SimilarRow[]>([]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    Promise.resolve(
      supabaseClient.rpc("similar_events", { ev: id, limit_count: 3 }),
    )
      .then(({ data }) => {
        if (!cancelled) setSimilar((data as SimilarRow[]) ?? []);
      })
      .catch(() => {
        if (!cancelled) setSimilar([]);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const { result: event, query } = useOne<EventRecord>({
    resource: "events",
    id,
  });
  const casesQuery = useList<CaseRecord>({
    resource: "cases",
    filters: [{ field: "event_id", operator: "eq", value: id as string }],
    sorters: [{ field: "created_at", order: "asc" }],
    pagination: { pageSize: 50 },
  });
  const statsQuery = useList<EventStats>({
    resource: "event_stats",
    filters: [{ field: "event_id", operator: "eq", value: id as string }],
  });
  const winnersQuery = useList<LeaderboardRow>({
    resource: "leaderboard",
    filters: [{ field: "event_id", operator: "eq", value: id as string }],
    sorters: [{ field: "total_score", order: "desc" }],
    pagination: { pageSize: 3 },
    queryOptions: { enabled: !!event?.results_published_at },
  });
  const organizerQuery = useOne<Organizer>({
    resource: "organizers",
    id: event?.author_id ?? "",
    queryOptions: { enabled: !!event?.author_id },
  });
  const coQuery = useList<CoRow>({
    resource: "event_cooccurrence",
    filters: [{ field: "event_id", operator: "eq", value: id as string }],
    sorters: [{ field: "strength", order: "desc" }],
    pagination: { pageSize: 3 },
    queryOptions: { enabled: !!id },
  });
  const relatedIds = (coQuery.result.data ?? []).map((r) => r.related_id);
  const relatedQuery = useList<EventRecord>({
    resource: "events",
    filters: [{ field: "id", operator: "in", value: relatedIds }],
    pagination: { pageSize: 3 },
    queryOptions: { enabled: relatedIds.length > 0 },
  });

  if (query.isLoading) return <Spinner />;
  if (!event)
    return (
      <div className="container-page py-12">
        <EmptyState
          title="Мероприятие не найдено"
          description="Возможно, оно ещё не опубликовано или было удалено."
          actionHref="/"
          actionLabel="К витрине событий"
        />
      </div>
    );

  const isCaseFormat = event.format === "case";
  const cases = casesQuery.result.data ?? [];
  const stats = statsQuery.result.data?.[0];
  const isAuthor = identity?.id === event.author_id;
  const closed = isRegistrationClosed(event);
  const coverUrl = publicFileUrl(COVERS_BUCKET, event.cover_path);
  const winners = (winnersQuery.result.data ?? []).slice(0, 3);
  const medals = ["🥇", "🥈", "🥉"];

  return (
    <div className="container-page py-10">
      <div className="mb-6 flex items-center gap-2 text-sm text-muted">
        <Link href="/" className="hover:text-navy-800">
          События
        </Link>
        <span>/</span>
        <span className="font-medium text-ink">{event.title}</span>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1.6fr_1fr]">
        {/* Main */}
        <div className="space-y-6">
          <div className="card overflow-hidden">
            {coverUrl ? (
              <img
                src={coverUrl}
                alt={event.title}
                className="h-56 w-full object-cover md:h-72"
              />
            ) : (
              <CoverPlaceholder seed={event.id} className="h-56 md:h-72" />
            )}
            <div className="p-6 md:p-8">
              <div className="flex flex-wrap items-center gap-2">
                <FormatBadge format={event.format} />
                {event.status === "draft" && (
                  <span className="badge badge-gray">Черновик</span>
                )}
                {closed && (
                  <span className="badge badge-gray">Запись закрыта</span>
                )}
          {similar.length > 0 && (
            <section>
              <h2 className="h2 mb-4">🧠 Похожие события</h2>
              <div className="grid gap-4 sm:grid-cols-3">
                {similar.map((s) => (
                  <Link
                    key={s.id}
                    href={`/events/${s.id}`}
                    className="card p-4 transition hover:shadow"
                  >
                    <p className="line-clamp-2 text-sm font-bold">{s.title}</p>
                    <p className="muted mt-1 text-xs">
                      {s.place || "Онлайн"} · близость{" "}
                      {Math.round(s.similarity * 100)}%
                    </p>
                  </Link>
                ))}
              </div>
              <p className="muted mt-2 text-xs">
                Найдены нейросетью по смыслу описаний (BGE-M3)
              </p>
            </section>
          )}

          {event.results_published_at && (
                  <span className="badge badge-gold">🏆 Итоги опубликованы</span>
                )}
              </div>
              <h1 className="h1 mt-3">{event.title}</h1>
              <p className="mt-4 whitespace-pre-wrap leading-relaxed text-[15px] text-slate-700">
                {event.description || "Описание появится позже."}
              </p>
            </div>
          </div>

          {isCaseFormat && (
            <section>
              <h2 className="h2 mb-4">Кейсы мероприятия</h2>
              {casesQuery.query.isLoading ? (
                <Spinner />
              ) : cases.length === 0 ? (
                <div className="card p-6 muted">
                  Кейсы будут опубликованы организатором ближе к старту.
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {cases.map((c, i) => (
                    <div key={c.id} className="card p-5">
                      <span className="badge badge-navy">Кейс {i + 1}</span>
                      <h3 className="mt-3 font-bold">{c.title}</h3>
                      <p className="muted mt-1.5 line-clamp-4">
                        {c.description}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {event.results_published_at && (
            <section>
              <h2 className="h2 mb-4">🏆 Итоги мероприятия</h2>
              {winnersQuery.query.isLoading ? (
                <Spinner />
              ) : winners.filter((w) => w.total_score > 0).length === 0 ? (
                <div className="card p-6 muted">
                  Оценённых работ пока нет.
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-3">
                  {winners.map((w, i) => (
                    <div
                      key={w.registration_id}
                      className={`card p-5 text-center ${
                        i === 0 ? "ring-2 ring-gold-500/60" : ""
                      }`}
                    >
                      <p className="text-3xl">{medals[i]}</p>
                      <p className="mt-2 font-bold">
                        {w.team_name || w.participant_name || "—"}
                      </p>
                      <p className="mt-1 text-2xl font-extrabold text-navy-800">
                        {w.total_score}
                      </p>
                      <p className="text-xs text-muted">баллов</p>
                    </div>
                  ))}
                </div>
              )}
              <Link
                href="/leaderboard"
                className="btn btn-ghost mt-4"
              >
                Полная таблица лидеров →
              </Link>
            </section>
          )}
          {(coQuery.result.data ?? []).length > 0 &&
            (relatedQuery.result.data ?? []).length > 0 && (
              <section>
                <h2 className="h2 mb-4">С этим событием также</h2>
                <div className="grid gap-4 sm:grid-cols-3">
                  {(relatedQuery.result.data ?? []).map((rel) => (
                    <Link
                      key={rel.id}
                      href={`/events/${rel.id}`}
                      className="card p-4 transition hover:shadow"
                    >
                      <p className="line-clamp-2 text-sm font-bold">{rel.title}</p>
                      <p className="muted mt-1 text-xs">
                        {rel.place || "Онлайн"}
                      </p>
                    </Link>
                  ))}
                </div>
                <p className="muted mt-2 text-xs">
                  По совместным просмотрам и сохранениям других пользователей
                </p>
              </section>
            )}
        </div>

        {/* Sidebar */}
        <aside className="space-y-5">
          <div className="card p-6">
            <h3 className="text-base font-bold">Детали</h3>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Начало</dt>
                <dd className="font-semibold">{formatDate(event.starts_at)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Приём заявок до</dt>
                <dd className="font-semibold">
                  {formatDate(event.registration_deadline)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Место</dt>
                <dd className="text-right font-semibold">
                  {event.place || "Онлайн"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">
                  {isCaseFormat ? "Команд участвует" : "Участников записалось"}
                </dt>
                <dd className="font-semibold">
                  {stats?.participants_count ?? 0}
                </dd>
              </div>
              {event.capacity != null && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">Осталось мест</dt>
                  <dd
                    className={`font-semibold ${
                      (stats?.seats_left ?? 0) === 0 ? "text-rose-600" : ""
                    }`}
                  >
                    {stats?.seats_left ?? 0} из {event.capacity}
                  </dd>
                </div>
              )}
              {isCaseFormat && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">Решений сдано</dt>
                  <dd className="font-semibold">{stats?.solutions_count ?? 0}</dd>
                </div>
              )}
            </dl>

            {closed ? (
              <div className="mt-5 rounded-xl bg-slate-100 px-4 py-3 text-center text-sm font-medium text-muted">
                Приём заявок закрыт
                {event.registration_deadline &&
                  ` — до ${formatDate(event.registration_deadline)}`}
              </div>
            ) : (
              <Link
                href={`/events/${event.id}/register`}
                className="btn btn-accent mt-5 w-full"
              >
                {isCaseFormat
                  ? "Зарегистрировать команду"
                  : "Записаться на лекцию"}
              </Link>
            )}
            {isAuthor && (
              <Link
                href={`/my/events/${event.id}`}
                className="btn btn-ghost mt-2 w-full"
              >
                Управление мероприятием
              </Link>
            )}
          </div>

          <div className="card p-6">
            <h3 className="text-base font-bold">Организатор</h3>
            <Link
              href={`/organizers/${event.author_id}`}
              className="mt-3 flex items-center gap-3 rounded-xl p-2 transition hover:bg-slate-50"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gold-500 text-sm font-bold text-navy-950">
                {(organizerQuery.result?.full_name ?? "?")
                  .split(" ")
                  .map((p) => p[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()}
              </span>
              <span>
                <span className="block text-sm font-bold">
                  {organizerQuery.result?.full_name || "Организатор"}
                </span>
                <span className="block text-xs text-navy-800">
                  Профиль и события →
                </span>
              </span>
            </Link>
          </div>

          <div className="card p-6">
            <h3 className="text-base font-bold">
              {isCaseFormat ? "Как всё проходит" : "Что нужно знать"}
            </h3>
            <ol className="mt-4 space-y-3 text-sm text-slate-700">
              {isCaseFormat ? (
                <>
                  <li>1. Регистрируете команду и выбираете кейс.</li>
                  <li>2. Организатор одобряет заявку.</li>
                  <li>3. Загружаете решение файлом до дедлайна.</li>
                  <li>4. Судьи оценивают по критериям.</li>
                  <li>5. Итоги — в таблице лидеров.</li>
                </>
              ) : (
                <>
                  <li>1. Оставляете заявку — этого достаточно.</li>
                  <li>2. Получаете подтверждение от организатора.</li>
                  <li>3. Приходите и слушаете.</li>
                </>
              )}
            </ol>
          </div>
        </aside>
      </div>
    </div>
  );
}
