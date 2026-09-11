"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import {
  useOne,
  useList,
  useGetIdentity,
  useNotification,
  useInvalidate,
} from "@refinedev/core";
import { solutionFileUrl, supabaseClient } from "@/lib/supabase";
import type { Identity } from "@/lib/auth";
import {
  EmptyState,
  Spinner,
  StatusBadge,
  formatDate,
} from "@/components/ui";
import { Guard } from "@/components/Guard";

type SolutionCard = {
  id: string;
  registration_id: string;
  title: string;
  description: string;
  file_path: string | null;
  status: string;
  created_at: string;
  event_id: string;
  event_title: string;
  team_name: string | null;
  case_title: string | null;
  blind_judging: boolean;
  total_score: number;
  judges_count: number;
};

type Criterion = {
  id: string;
  event_id: string;
  title: string;
  max_score: number;
  sort_order: number;
};

type Score = {
  id: string;
  solution_id: string;
  judge_id: string;
  criterion_id: string;
  score: number;
  comment: string;
};

function ReviewForm() {
  const { id } = useParams<{ id: string }>();
  const { data: identity } = useGetIdentity<Identity | null>();
  const { open } = useNotification();
  const invalidate = useInvalidate();

  const { result: solution, query } = useOne<SolutionCard>({
    resource: "judge_work_cards",
    id,
  });

  const criteriaQuery = useList<Criterion>({
    resource: "criteria",
    filters: [
      { field: "event_id", operator: "eq", value: solution?.event_id ?? "" },
    ],
    sorters: [{ field: "sort_order", order: "asc" }],
    pagination: { pageSize: 50 },
    queryOptions: { enabled: !!solution?.event_id },
  });
  const myScoresQuery = useList<Score>({
    resource: "scores",
    filters: [
      { field: "solution_id", operator: "eq", value: id as string },
      { field: "judge_id", operator: "eq", value: identity?.id ?? "" },
    ],
    pagination: { pageSize: 50 },
    queryOptions: { enabled: !!identity?.id },
  });

  const [scores, setScores] = useState<Record<string, number>>({});
  const [comment, setComment] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const criteria = [...(criteriaQuery.result.data ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order,
  );

  const myScores = useMemo(
    () => myScoresQuery.result.data ?? [],
    [myScoresQuery.result.data],
  );
  const existingScores = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of myScores) map[s.criterion_id] = s.score;
    return map;
  }, [myScores]);
  const existingComment = myScores[0]?.comment ?? "";
  const effectiveScores = useCallback(
    (criterionId: string) => scores[criterionId] ?? existingScores[criterionId],
    [scores, existingScores],
  );

  if (query.isLoading) return <Spinner />;
  if (!solution)
    return (
      <EmptyState
        title="Работа не найдена"
        description="У вас нет доступа к этой работе или она удалена."
        actionHref="/judge"
        actionLabel="К панели судьи"
      />
    );

  const maxTotal = criteria.reduce((acc, c) => acc + c.max_score, 0);
  const currentTotal = criteria.reduce(
    (acc, c) => acc + (effectiveScores(c.id) ?? 0),
    0,
  );
  const alreadyScored = myScores.length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!identity) return;
    if (criteria.some((c) => effectiveScores(c.id) === undefined)) {
      open?.({
        type: "error",
        message: "Выставьте баллы по всем критериям",
      });
      return;
    }
    setBusy(true);
    try {
      const rows = criteria.map((c) => ({
        solution_id: solution!.id,
        judge_id: identity!.id,
        criterion_id: c.id,
        score: effectiveScores(c.id) ?? 0,
        comment: comment ?? existingComment,
      }));
      const { error } = await supabaseClient
        .from("scores")
        .upsert(rows, { onConflict: "solution_id,judge_id,criterion_id" });
      if (error) throw error;

      invalidate({
        resource: "solution_cards",
        id: solution!.id,
        invalidates: ["detail", "list"],
      });
      invalidate({ resource: "leaderboard", invalidates: ["list"] });
      open?.({
        type: "success",
        message: alreadyScored ? "Оценка обновлена" : "Оценка отправлена",
        description: `Итог: ${currentTotal} из ${maxTotal} баллов.`,
      });
    } catch (err) {
      open?.({
        type: "error",
        message: "Не удалось сохранить оценку",
        description:
          (err as { message?: string })?.message ?? undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container-page py-10">
      <div className="mb-6 flex items-center gap-2 text-sm text-muted">
        <Link href="/judge" className="hover:text-navy-800">
          Судейство
        </Link>
        <span>/</span>
        <span className="font-medium text-ink">{solution.title}</span>
      </div>

      <div className="grid items-start gap-8 lg:grid-cols-[1.6fr_1fr]">
        {/* Work */}
        <div className="card p-6 md:p-8">
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge badge-navy">{solution.event_title}</span>
            {solution.case_title && (
              <span className="badge badge-gray">{solution.case_title}</span>
            )}
            <StatusBadge status={solution.status} />
          </div>
          <h1 className="h1 mt-3">{solution.title}</h1>
          <p className="muted mt-1">
            {solution.team_name === null
              ? "Авторство скрыто (слепое судейство)"
              : solution.team_name || "Без команды"}{" "}
            · загружено {formatDate(solution.created_at)}
          </p>
          {solution.description && (
            <p className="mt-4 whitespace-pre-wrap leading-relaxed text-[15px] text-slate-700">
              {solution.description}
            </p>
          )}

          {solution.file_path ? (
            <a
              className="btn btn-primary mt-6"
              href={solutionFileUrl(solution.file_path) ?? "#"}
              target="_blank"
              rel="noreferrer"
            >
              Открыть файл решения
            </a>
          ) : (
            <p className="muted mt-6">Файл решения не приложен.</p>
          )}
        </div>

        {/* Score form */}
        <form onSubmit={submit} className="card p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="h2">Оценочный лист</h2>
            <p className="text-lg font-extrabold text-navy-800">
              {currentTotal}
              <span className="text-sm font-semibold text-muted">
                {" "}/ {maxTotal}
              </span>
            </p>
          </div>

          {alreadyScored && (
            <p className="mt-2 rounded-xl bg-gold-100 px-3 py-2 text-xs font-medium text-[#92610a]">
              Вы уже оценивали эту работу — можно скорректировать баллы.
            </p>
          )}

          <div className="mt-5 space-y-5">
            {criteriaQuery.query.isLoading ? (
              <Spinner />
            ) : criteria.length === 0 ? (
              <p className="muted">
                Организатор ещё не задал критерии оценки для этого события.
              </p>
            ) : (
              criteria.map((c) => (
                <div key={c.id}>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-sm font-semibold">{c.title}</span>
                    <span className="muted text-xs">
                      до {c.max_score} баллов
                    </span>
                  </div>
                  <div className="flex gap-1.5">
                    {Array.from({ length: c.max_score + 1 }, (_, v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() =>
                          setScores((prev) => ({ ...prev, [c.id]: v }))
                        }
                        className={`h-9 flex-1 rounded-lg border text-sm font-semibold transition ${
                          effectiveScores(c.id) === v
                            ? "border-navy-800 bg-navy-800 text-white"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                        }`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}

            <div>
              <label className="label">Комментарий для организатора</label>
              <textarea
                className="input min-h-24"
                placeholder="Сильные и слабые стороны работы"
                value={comment ?? existingComment}
                onChange={(e) => setComment(e.target.value)}
              />
            </div>
          </div>

          <button
            className="btn btn-primary mt-6 w-full"
            disabled={busy || criteria.length === 0}
          >
            {busy ? "Сохраняем…" : alreadyScored ? "Обновить оценку" : "Отправить оценку"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function ReviewPage() {
  return (
    <Guard>
      <ReviewForm />
    </Guard>
  );
}
