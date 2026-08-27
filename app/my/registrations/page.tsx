"use client";

import Link from "next/link";
import { useState } from "react";
import {
  useList,
  useGetIdentity,
  useCreate,
  useNotification,
} from "@refinedev/core";
import { SOLUTIONS_BUCKET, solutionFileUrl, supabaseClient } from "@/lib/supabase";
import type { Identity } from "@/lib/auth";
import type { EventRecord } from "@/components/EventCard";
import {
  EmptyState,
  Field,
  FormatBadge,
  Spinner,
  StatusBadge,
  formatDate,
} from "@/components/ui";
import { Guard } from "@/components/Guard";

type Registration = {
  id: string;
  event_id: string;
  team_id: string | null;
  case_id: string | null;
  status: string;
  created_at: string;
};

type CaseRecord = { id: string; title: string };
type Team = { id: string; name: string; captain_id: string | null; invite_code: string | null };
type Profile = { id: string; full_name: string };
type TeamMember = { team_id: string; user_id: string };

type Solution = {
  id: string;
  registration_id: string;
  title: string;
  description: string;
  file_path: string | null;
  status: string;
  total_score: number;
  judges_count: number;
};

function MyRegistrations() {
  const { data: identity } = useGetIdentity<Identity | null>();
  const { open } = useNotification();
  const { mutateAsync: createSolution } = useCreate();

  const regsQuery = useList<Registration>({
    resource: "registrations",
    filters: [{ field: "user_id", operator: "eq", value: identity?.id ?? "" }],
    sorters: [{ field: "created_at", order: "desc" }],
    pagination: { pageSize: 100 },
    queryOptions: { enabled: !!identity?.id },
  });
  const eventsQuery = useList<EventRecord>({
    resource: "events",
    pagination: { pageSize: 200 },
  });
  const casesQuery = useList<CaseRecord>({
    resource: "cases",
    pagination: { pageSize: 200 },
  });
  const teamsQuery = useList<Team>({
    resource: "teams",
    pagination: { pageSize: 300 },
  });
  const profilesQuery = useList<Profile>({
    resource: "profiles",
    pagination: { pageSize: 500 },
  });
  const teamMembersQuery = useList<TeamMember>({
    resource: "team_members",
    pagination: { pageSize: 500 },
  });
  const solutionsQuery = useList<Solution>({
    resource: "solution_cards",
    pagination: { pageSize: 200 },
  });

  const regIds = (regsQuery.result.data ?? []).map((r) => r.id);
  const solutions = (solutionsQuery.result.data ?? []).filter((s) =>
    regIds.includes(s.registration_id),
  );
  const solutionByReg = new Map(solutions.map((s) => [s.registration_id, s]));

  const events = new Map(
    (eventsQuery.result.data ?? []).map((e) => [e.id, e]),
  );
  const cases = new Map((casesQuery.result.data ?? []).map((c) => [c.id, c]));
  const teams = new Map((teamsQuery.result.data ?? []).map((t) => [t.id, t]));

  return (
    <div className="container-page py-10">
      <h1 className="h1">Мои регистрации</h1>
      <p className="muted mt-1">
        Заявки на события. Для кейс-чемпионатов здесь загружаются решения
        команды.
      </p>

      <div className="mt-8 grid gap-5">
        {regsQuery.query.isLoading ? (
          <Spinner />
        ) : regIds.length === 0 ? (
          <EmptyState
            title="Вы пока никуда не записаны"
            description="Выберите событие в витрине и подайте заявку."
            actionHref="/"
            actionLabel="К витрине событий"
          />
        ) : (
          (regsQuery.result.data ?? []).map((reg) => {
            const event = events.get(reg.event_id);
            if (!event) return null;
            const isCaseFormat = event.format === "case";
            const solution = solutionByReg.get(reg.id);

            return (
              <div key={reg.id} className="card p-5 md:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <FormatBadge format={event.format} />
                      <StatusBadge status={reg.status} />
                    </div>
                    <h3 className="mt-2 text-lg font-bold">{event.title}</h3>
                    <p className="muted mt-0.5">
                      {formatDate(event.starts_at)}
                      {event.place ? ` · ${event.place}` : ""}
                      {reg.team_id
                        ? ` · Команда «${teams.get(reg.team_id)?.name ?? ""}»`
                        : ""}
                      {reg.case_id
                        ? ` · Кейс: ${cases.get(reg.case_id)?.title ?? ""}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {event.results_published_at && reg.status === "approved" && (
                      <Link href={`/diploma/${reg.id}`} className="btn btn-accent">
                        🏆 Диплом
                      </Link>
                    )}
                    <Link
                      href={`/events/${event.id}`}
                      className="btn btn-ghost"
                    >
                      К событию
                    </Link>
                  </div>
                </div>

                {isCaseFormat && (
                  <div className="mt-5 border-t border-slate-100 pt-5">
                    {reg.team_id && teams.get(reg.team_id)?.captain_id === identity?.id && (
                      <InviteBlock
                        teamName={teams.get(reg.team_id)?.name ?? ""}
                        inviteCode={teams.get(reg.team_id)?.invite_code ?? ""}
                        members={(teamMembersQuery.result.data ?? [])
                          .filter((m) => m.team_id === reg.team_id)
                          .map(
                            (m) =>
                              profilesQuery.result.data?.find((p) => p.id === m.user_id)
                                ?.full_name ?? "Участник",
                          )}
                      />
                    )}
                    {solution ? (
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-semibold">{solution.title}</p>
                          {solution.description && (
                            <p className="muted mt-0.5 line-clamp-2">
                              {solution.description}
                            </p>
                          )}
                          <p className="muted mt-1">
                            Баллы: <b>{solution.total_score}</b> · оценили{" "}
                            {solution.judges_count} судь
                            {solution.judges_count === 1 ? "я" : "ей"}
                          </p>
                        </div>
                  <div className="flex gap-2">
                          {solution.file_path && (
                            <a
                              className="btn btn-ghost"
                              href={solutionFileUrl(solution.file_path) ?? "#"}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Файл
                            </a>
                          )}
                          <StatusBadge status={solution.status} />
                        </div>
                      </div>
                    ) : (
                      <UploadSolution
                        registrationId={reg.id}
                        approved={reg.status === "approved"}
                        onUploaded={(sol) => {
                          open?.({
                            type: "success",
                            message: "Решение загружено",
                            description: "Судьи увидят его в очереди проверки.",
                          });
                          return createSolution({
                            resource: "solutions",
                            values: sol,
                          });
                        }}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function UploadSolution({
  registrationId,
  approved,
  onUploaded,
}: {
  registrationId: string;
  approved: boolean;
  onUploaded: (values: {
    registration_id: string;
    title: string;
    description: string;
    file_path: string;
  }) => Promise<unknown>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) return setError("Укажите название решения");
    if (!file) return setError("Прикрепите файл решения");
    setBusy(true);
    try {
      const path = `${registrationId}/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabaseClient.storage
        .from(SOLUTIONS_BUCKET)
        .upload(path, file);
      if (upErr) throw upErr;
      await onUploaded({
        registration_id: registrationId,
        title: title.trim(),
        description,
        file_path: path,
      });
      setTitle("");
      setDescription("");
      setFile(null);
    } catch (err) {
      setError(
        (err as { message?: string })?.message ?? "Не удалось загрузить решение",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!approved) {
    return (
      <p className="rounded-xl bg-gold-100 px-4 py-3 text-sm font-medium text-[#92610a]">
        Решение можно загрузить после одобрения заявки организатором.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm font-bold">Загрузить решение</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Название решения" required>
          <input
            className="input"
            placeholder="Умная теплица на Arduino"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label="Файл решения" required hint="PDF, архив или презентация — до 50 МБ">
          <input
            className="input file:mr-3 file:rounded-lg file:border-0 file:bg-navy-50 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-navy-800"
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </Field>
      </div>
      <Field label="Краткое описание">
        <textarea
          className="input min-h-20"
          placeholder="Что сделано, как работает, какие результаты"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      {error && (
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
          {error}
        </p>
      )}
      <button className="btn btn-accent" disabled={busy}>
        {busy ? "Загружаем…" : "Отправить решение"}
      </button>
    </form>
  );
}

function InviteBlock({
  teamName,
  inviteCode,
  members,
}: {
  teamName: string;
  inviteCode: string;
  members: string[];
}) {
  const { open } = useNotification();
  const [copied, setCopied] = useState(false);
  const link =
    typeof window !== "undefined" && inviteCode
      ? `${window.location.origin}/join/${inviteCode}`
      : "";

  return (
    <div className="mb-5 rounded-xl bg-navy-50 p-4">
      <p className="text-sm font-bold">
        Пригласить в команду «{teamName}»
      </p>
      <p className="muted mt-0.5 text-xs">
        Отправьте ссылку участникам — они присоединятся к команде и событию.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input className="input flex-1 bg-white" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
        <button
          className="btn btn-primary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
            } catch {
              /* clipboard недоступен */
            }
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
            open?.({ type: "success", message: "Ссылка скопирована" });
          }}
        >
          {copied ? "✓ Скопировано" : "Скопировать"}
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {members.map((name, i) => (
          <span key={i} className="badge badge-gray">
            {name}
          </span>
        ))}
        {members.length === 0 && (
          <span className="muted text-xs">Пока только вы</span>
        )}
      </div>
    </div>
  );
}

export default function MyRegistrationsPage() {
  return (
    <Guard>
      <MyRegistrations />
    </Guard>
  );
}
