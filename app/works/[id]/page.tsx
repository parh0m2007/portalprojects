"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useOne, useList } from "@refinedev/core";
import type { EventRecord } from "@/components/EventCard";
import { COVERS_BUCKET, publicFileUrl, solutionFileUrl } from "@/lib/supabase";
import { CoverPlaceholder, EmptyState, Spinner, formatDate } from "@/components/ui";

type SolutionCard = {
  id: string;
  registration_id: string;
  title: string;
  description: string;
  file_path: string | null;
  created_at: string;
  event_id: string;
  event_title: string;
  team_name: string | null;
  case_title: string | null;
  total_score: number;
  judges_count: number;
  results_published_at: string | null;
};

type Criterion = { id: string; title: string; max_score: number; sort_order: number };
type Score = { id: string; criterion_id: string; score: number };

const MEDALS = ["🥇", "🥈", "🥉"];

export default function WorkDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { result: work, query } = useOne<SolutionCard>({
    resource: "solution_cards",
    id,
  });

  const criteriaQuery = useList<Criterion>({
    resource: "criteria",
    filters: [
      { field: "event_id", operator: "eq", value: work?.event_id ?? "" },
    ],
    sorters: [{ field: "sort_order", order: "asc" }],
    pagination: { pageSize: 50 },
    queryOptions: { enabled: !!work?.event_id },
  });
  const scoresQuery = useList<Score>({
    resource: "scores",
    filters: [{ field: "solution_id", operator: "eq", value: id as string }],
    pagination: { pageSize: 200 },
    queryOptions: { enabled: !!id },
  });
  const eventQuery = useOne<EventRecord>({
    resource: "events",
    id: work?.event_id ?? "",
    queryOptions: { enabled: !!work?.event_id },
  });
  // место работы внутри события
  const eventWorksQuery = useList<SolutionCard>({
    resource: "solution_cards",
    filters: [
      { field: "event_id", operator: "eq", value: work?.event_id ?? "" },
    ],
    sorters: [{ field: "total_score", order: "desc" }],
    pagination: { pageSize: 200 },
    queryOptions: { enabled: !!work?.event_id },
  });

  if (query.isLoading) return <Spinner />;
  if (!work || !work.results_published_at)
    return (
      <div className="container-page py-12">
        <EmptyState
          title="Работа не найдена"
          description="Она ещё не опубликована: работы появляются в галерее после публикации итогов мероприятия."
          actionHref="/works"
          actionLabel="К галерее работ"
        />
      </div>
    );

  const coverUrl =
    publicFileUrl(COVERS_BUCKET, eventQuery.result?.cover_path) ?? null;
  const fileUrl = solutionFileUrl(work.file_path);

  const place =
    (eventWorksQuery.result.data ?? []).findIndex((w) => w.id === work.id) + 1;
  const criteria = [...(criteriaQuery.result.data ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order,
  );
  const scores = scoresQuery.result.data ?? [];
  const maxTotal = criteria.reduce((acc, c) => acc + c.max_score, 0);

  const avgByCriterion = criteria.map((c) => {
    const list = scores.filter((s) => s.criterion_id === c.id);
    const avg = list.length
      ? list.reduce((acc, s) => acc + s.score, 0) / list.length
      : 0;
    return { ...c, avg, count: list.length };
  });

  return (
    <div className="container-page py-10">
      <div className="mb-6 flex items-center gap-2 text-sm text-muted">
        <Link href="/" className="hover:text-navy-800">
          События
        </Link>
        <span>/</span>
        <Link href="/works" className="hover:text-navy-800">
          Работы
        </Link>
        <span>/</span>
        <span className="font-medium text-ink">{work.title}</span>
      </div>

      <div className="grid items-start gap-8 lg:grid-cols-[1.6fr_1fr]">
        {/* Работа */}
        <div className="space-y-6">
          <div className="card overflow-hidden">
            {coverUrl ? (
              <img
                src={coverUrl}
                alt={work.event_title}
                className="h-56 w-full object-cover md:h-72"
              />
            ) : (
              <CoverPlaceholder seed={work.id} className="h-56 md:h-72" />
            )}
            <div className="p-6 md:p-8">
              <div className="flex flex-wrap items-center gap-2">
                {place > 0 && place <= 3 && (
                  <span className="badge badge-gold">
                    {MEDALS[place - 1]} {place} место на «{work.event_title}»
                  </span>
                )}
                {work.case_title && (
                  <span className="badge badge-navy">{work.case_title}</span>
                )}
              </div>
              <h1 className="h1 mt-3">{work.title}</h1>
              <p className="muted mt-1">
                {work.team_name || "Без команды"} · {work.event_title} ·
                загружено {formatDate(work.created_at)}
              </p>
              {work.description && (
                <p className="mt-4 whitespace-pre-wrap leading-relaxed text-[15px] text-slate-700">
                  {work.description}
                </p>
              )}
              {fileUrl && (
                <a
                  className="btn btn-primary mt-6"
                  href={fileUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Открыть файл решения
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Оценки жюри */}
        <aside className="space-y-5">
          <div className="card bg-navy-800 p-6 text-white">
            <p className="text-sm text-navy-100/80">Оценка жюри</p>
            <p className="mt-1 text-4xl font-extrabold">
              {work.total_score}
              <span className="text-base font-semibold text-navy-100/70">
                {" "}
                из {maxTotal}
              </span>
            </p>
            <p className="mt-1 text-sm text-navy-100/70">
              {work.judges_count} судь{work.judges_count === 1 ? "я" : "ей"}
            </p>

            <div className="mt-5 space-y-4">
              {avgByCriterion.map((c) => (
                <div key={c.id}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-navy-100/85">{c.title}</span>
                    <span className="font-bold text-gold-400">
                      {c.avg.toFixed(1)}/{c.max_score}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/15">
                    <div
                      className="h-full rounded-full bg-gold-500"
                      style={{ width: `${(c.avg / c.max_score) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Link href={`/events/${work.event_id}`} className="btn btn-ghost w-full">
            Страница события
          </Link>
          <Link href="/works" className="btn btn-ghost w-full">
            Все работы
          </Link>
        </aside>
      </div>
    </div>
  );
}
