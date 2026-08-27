"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import * as XLSX from "xlsx";
import {
  useOne,
  useList,
  useUpdate,
  useCreate,
  useGetIdentity,
  useNotification,
  useInvalidate,
} from "@refinedev/core";
import {
  COVERS_BUCKET,
  publicFileUrl,
  solutionFileUrl,
  supabaseClient,
} from "@/lib/supabase";
import type { Identity } from "@/lib/auth";
import type { EventRecord } from "@/components/EventCard";
import {
  EmptyState,
  Spinner,
  StatCard,
  StatusBadge,
  formatDate,
} from "@/components/ui";
import { TagChips, type Tag } from "@/components/TagChips";
import { Guard } from "@/components/Guard";

type Registration = {
  id: string;
  event_id: string;
  user_id: string;
  team_id: string | null;
  case_id: string | null;
  contact: string;
  comment: string;
  status: string;
  created_at: string;
};

type Profile = { id: string; full_name: string; email: string };
type Team = { id: string; name: string };
type CaseRecord = { id: string; title: string };

type SolutionCard = {
  id: string;
  registration_id: string;
  title: string;
  description: string;
  file_path: string | null;
  status: string;
  team_name: string | null;
  case_title: string | null;
  total_score: number;
  judges_count: number;
};

type EventJudge = {
  event_id: string;
  user_id: string;
  status: string;
};

type EventTag = { event_id: string; tag_id: string };
type Score = { id: string; judge_id: string; solution_id: string };

type LeaderboardRow = {
  registration_id: string;
  team_id: string | null;
  team_name: string | null;
  participant_name: string | null;
  total_score: number;
  judges_count: number;
};

function EventAdmin() {
  const { id } = useParams<{ id: string }>();
  const { data: identity } = useGetIdentity<Identity | null>();
  const { open } = useNotification();
  const { mutate: updateRegistration } = useUpdate();
  const { mutate: updateEvent } = useUpdate();
  const { mutateAsync: createJudge } = useCreate();
  const invalidate = useInvalidate();

  const { result: event, query } = useOne<EventRecord>({
    resource: "events",
    id,
  });

  const regsQuery = useList<Registration>({
    resource: "registrations",
    filters: [{ field: "event_id", operator: "eq", value: id as string }],
    sorters: [{ field: "created_at", order: "desc" }],
    pagination: { pageSize: 200 },
  });
  const profilesQuery = useList<Profile>({
    resource: "profiles",
    pagination: { pageSize: 500 },
  });
  const teamsQuery = useList<Team>({
    resource: "teams",
    pagination: { pageSize: 300 },
  });
  const casesQuery = useList<CaseRecord>({
    resource: "cases",
    filters: [{ field: "event_id", operator: "eq", value: id as string }],
    pagination: { pageSize: 50 },
  });
  const solutionsQuery = useList<SolutionCard>({
    resource: "solution_cards",
    filters: [{ field: "event_id", operator: "eq", value: id as string }],
    sorters: [{ field: "total_score", order: "desc" }],
    pagination: { pageSize: 200 },
  });
  const judgesQuery = useList<EventJudge>({
    resource: "event_judges",
    filters: [{ field: "event_id", operator: "eq", value: id as string }],
    pagination: { pageSize: 100 },
  });
  const boardQuery = useList<LeaderboardRow>({
    resource: "leaderboard",
    filters: [{ field: "event_id", operator: "eq", value: id as string }],
    sorters: [{ field: "total_score", order: "desc" }],
    pagination: { pageSize: 200 },
  });
  const tagsQuery = useList<Tag>({
    resource: "tags",
    sorters: [{ field: "sort_order", order: "asc" }],
    pagination: { pageSize: 100 },
  });
  const eventTagsQuery = useList<EventTag>({
    resource: "event_tags",
    filters: [{ field: "event_id", operator: "eq", value: id as string }],
    pagination: { pageSize: 50 },
  });
  const solutionIds = (solutionsQuery.result.data ?? []).map((s) => s.id);
  const scoresQuery = useList<Score>({
    resource: "scores",
    filters: [
      { field: "solution_id", operator: "in", value: solutionIds },
    ],
    pagination: { pageSize: 500 },
    queryOptions: { enabled: solutionIds.length > 0 },
  });

  const [judgeEmail, setJudgeEmail] = useState("");
  const [judgeBusy, setJudgeBusy] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const [capacityInput, setCapacityInput] = useState<string | null>(null);

  const regsByDay = useMemo(() => {
    const buckets = new Map<string, number>();
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      buckets.set(d.toISOString().slice(0, 10), 0);
    }
    for (const r of regsQuery.result.data ?? []) {
      const key = (r.created_at ?? "").slice(0, 10);
      if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    return [...buckets.entries()].map(([day, count]) => ({
      day: day.slice(8) + "." + day.slice(5, 7),
      count,
    }));
  }, [regsQuery.result.data]);

  const judgesActivity = useMemo(() => {
    const profilesMap = new Map(
      (profilesQuery.result.data ?? []).map((p) => [p.id, p.full_name]),
    );
    const counts = new Map<string, number>();
    for (const s of scoresQuery.result.data ?? []) {
      counts.set(s.judge_id, (counts.get(s.judge_id) ?? 0) + 1);
    }
    return [...counts.entries()].map(([judgeId, count]) => ({
      name: profilesMap.get(judgeId) ?? "Судья",
      count,
    }));
  }, [scoresQuery.result.data, profilesQuery.result.data]);

  if (query.isLoading) return <Spinner />;
  if (!event)
    return (
      <EmptyState
        title="Мероприятие не найдено"
        actionHref="/my"
        actionLabel="К моим мероприятиям"
      />
    );

  const regs = regsQuery.result.data ?? [];
  const profiles = new Map(
    (profilesQuery.result.data ?? []).map((p) => [p.id, p]),
  );
  const teams = new Map((teamsQuery.result.data ?? []).map((t) => [t.id, t]));
  const cases = new Map((casesQuery.result.data ?? []).map((c) => [c.id, c]));
  const solutions = solutionsQuery.result.data ?? [];
  const judges = judgesQuery.result.data ?? [];

  const approved = regs.filter((r) => r.status === "approved").length;
  const pending = regs.filter((r) => r.status === "pending").length;
  const acceptedJudges = judges.filter((j) => j.status === "accepted").length;
  const isCaseFormat = event.format === "case";

  function setRegStatus(regId: string, status: string) {
    updateRegistration(
      { resource: "registrations", id: regId, values: { status } },
      {
        onSuccess: () =>
          open?.({
            type: "success",
            message: status === "approved" ? "Заявка одобрена" : "Заявка отклонена",
          }),
      },
    );
  }

  function setEventStatus(status: string) {
    updateEvent(
      { resource: "events", id: event!.id, values: { status } },
      {
        onSuccess: () =>
          open?.({
            type: "success",
            message:
              status === "finished"
                ? "Мероприятие завершено — приём заявок закрыт"
                : "Мероприятие снова публикуется",
          }),
      },
    );
  }

  async function uploadCover(file: File) {
    setCoverBusy(true);
    try {
      const path = `${event!.id}/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabaseClient.storage
        .from(COVERS_BUCKET)
        .upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      updateEvent(
        { resource: "events", id: event!.id, values: { cover_path: path } },
        {
          onSuccess: () =>
            open?.({ type: "success", message: "Обложка обновлена" }),
        },
      );
    } catch (err) {
      open?.({
        type: "error",
        message: "Не удалось загрузить обложку",
        description: (err as { message?: string })?.message,
      });
    } finally {
      setCoverBusy(false);
    }
  }

  async function publishResults() {
    setPublishBusy(true);
    try {
      const { error } = await supabaseClient.rpc("publish_results", {
        ev: event!.id,
      });
      if (error) throw error;
      invalidate({
        resource: "events",
        id: event!.id,
        invalidates: ["detail", "list"],
      });
      open?.({
        type: "success",
        message: "Итоги опубликованы",
        description: "Участники получили уведомление, медали — на странице события.",
      });
    } catch (err) {
      open?.({
        type: "error",
        message: "Не удалось опубликовать итоги",
        description: (err as { message?: string })?.message,
      });
    } finally {
      setPublishBusy(false);
    }
  }

  const eventTagIds = new Set(
    (eventTagsQuery.result.data ?? []).map((et) => et.tag_id),
  );

  function toggleEventTag(tagId: string) {
    if (!event) return;
    if (eventTagIds.has(tagId)) {
      supabaseClient
        .from("event_tags")
        .delete()
        .eq("event_id", event.id)
        .eq("tag_id", tagId)
        .then(() => eventTagsQuery.query.refetch().catch(() => {}));
    } else {
      supabaseClient
        .from("event_tags")
        .insert({ event_id: event.id, tag_id: tagId })
        .then(() => eventTagsQuery.query.refetch().catch(() => {}));
    }
  }

  function downloadXlsx(
    rows: Record<string, string | number>[],
    sheetName: string,
    filename: string,
  ) {
    const ws = XLSX.utils.json_to_sheet(
      rows.length > 0 ? rows : [{ info: "Нет данных" }],
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, filename);
  }

  function exportRegistrations() {
    const statusRu: Record<string, string> = {
      pending: "На рассмотрении",
      approved: "Одобрена",
      rejected: "Отклонена",
    };
    downloadXlsx(
      regs.map((r, i) => ({
        "№": i + 1,
        Участник: profiles.get(r.user_id)?.full_name ?? "",
        Email: profiles.get(r.user_id)?.email ?? "",
        Команда: r.team_id ? teams.get(r.team_id)?.name ?? "" : "",
        Кейс: r.case_id ? cases.get(r.case_id)?.title ?? "" : "",
        Контакт: r.contact,
        Комментарий: r.comment,
        Статус: statusRu[r.status] ?? r.status,
        Дата: formatDate(r.created_at),
      })),
      "Заявки",
      `zayavki-${event!.title.slice(0, 30)}.xlsx`,
    );
  }

  function exportResults() {
    const rows = (boardQuery.result.data ?? [])
      .sort((a, b) => b.total_score - a.total_score)
      .map((row, i) => ({
        Место: i + 1,
        "Команда/участник": row.team_name || row.participant_name || "",
        Баллы: row.total_score,
        Судей: row.judges_count,
      }));
    downloadXlsx(rows, "Итоги", `itogi-${event!.title.slice(0, 30)}.xlsx`);
  }

  async function addJudge(e: React.FormEvent) {
    e.preventDefault();
    if (!judgeEmail.trim() || !identity) return;
    setJudgeBusy(true);
    try {
      const { data: profile, error } = await supabaseClient
        .from("profiles")
        .select("id, full_name, email")
        .ilike("email", judgeEmail.trim())
        .maybeSingle();
      if (error || !profile) {
        open?.({
          type: "error",
          message: "Пользователь не найден",
          description: "Пользователь должен зарегистрироваться на портале.",
        });
        return;
      }
      if (profile.id === identity.id) {
        open?.({
          type: "error",
          message: "Вы уже судья",
          description: "Автор мероприятия имеет права судьи по умолчанию.",
        });
        return;
      }
      await createJudge({
        resource: "event_judges",
        values: {
          event_id: id,
          user_id: profile.id,
          invited_by: identity.id,
          status: "pending",
        },
      });
      open?.({
        type: "success",
        message: "Приглашение отправлено",
        description: `${profile.full_name || profile.email} получит права судьи после подтверждения.`,
      });
      setJudgeEmail("");
    } finally {
      setJudgeBusy(false);
    }
  }

  return (
    <div className="container-page py-10">
      <div className="mb-6 flex items-center gap-2 text-sm text-muted">
        <Link href="/my" className="hover:text-navy-800">
          Мои мероприятия
        </Link>
        <span>/</span>
        <span className="font-medium text-ink">{event.title}</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="h1">{event.title}</h1>
          <p className="muted mt-1">
            {isCaseFormat ? "Кейс-чемпионат" : "Лекция"} ·{" "}
            {formatDate(event.starts_at)}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/events/${id}`} className="btn btn-ghost">
            Открыть страницу события
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard value={regs.length} label="заявок подано" />
        <StatCard value={approved} label="одобрено" />
        {isCaseFormat ? (
          <StatCard value={solutions.length} label="решений сдано" />
        ) : (
          <StatCard value={pending} label="ожидают подтверждения" />
        )}
        <StatCard
          value={`${acceptedJudges + 1}`}
          label="судей (вы + принятые)"
          tone="navy"
        />
      </div>

      {/* Публикация, обложка и экспорт */}
      <section className="mt-6">
        <div className="card grid gap-6 p-5 md:grid-cols-3 md:p-6">
          {/* Обложка */}
          <div>
            <p className="text-sm font-bold">Обложка события</p>
            <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
              {publicFileUrl(COVERS_BUCKET, event.cover_path) ? (
                <img
                  src={publicFileUrl(COVERS_BUCKET, event.cover_path)!}
                  alt="Обложка"
                  className="h-28 w-full object-cover"
                />
              ) : (
                <div className="flex h-28 items-center justify-center bg-slate-50 text-sm text-muted">
                  Не задана — будет градиент
                </div>
              )}
            </div>
            <label
              className={`btn btn-ghost mt-3 w-full ${coverBusy ? "opacity-60" : ""}`}
            >
              {coverBusy ? "Загружаем…" : event.cover_path ? "Заменить обложку" : "Загрузить обложку"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={coverBusy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadCover(f);
                  e.target.value = "";
                }}
              />
            </label>
          </div>

          {/* Статус и итоги */}
          <div>
            <p className="text-sm font-bold">Статус приёма заявок</p>
            <select
              className="input mt-3"
              value={event.status}
              onChange={(e) => setEventStatus(e.target.value)}
            >
              <option value="published">Открыт (опубликовано)</option>
              <option value="finished">Закрыт (завершено)</option>
            </select>

            <p className="mt-4 text-sm font-bold">Лимит мест</p>
            <div className="mt-2 flex gap-2">
              <input
                className="input"
                type="number"
                min={0}
                placeholder="Без лимита"
                value={
                  capacityInput ??
                  (event.capacity != null ? String(event.capacity) : "")
                }
                onChange={(e) => setCapacityInput(e.target.value)}
                onBlur={() => {
                  const raw = capacityInput;
                  if (raw === null) return;
                  const parsed = raw.trim() === "" ? null : Number(raw);
                  if (parsed === null || (Number.isFinite(parsed) && parsed >= 0)) {
                    updateEvent({
                      resource: "events",
                      id: event!.id,
                      values: { capacity: parsed },
                    });
                  }
                }}
              />
            </div>
            <p className="muted mt-2 text-xs">
              Пусто = без лимита. Когда места закончатся, новые заявки попадут
              в лист ожидания.
            </p>
            <p className="muted mt-2 text-xs">
              Также закрывается автоматически после дедлайна
              {event.registration_deadline
                ? ` (${formatDate(event.registration_deadline)})`
                : ""}
              .
            </p>

            {event.results_published_at ? (
              <p className="mt-3 rounded-xl bg-green-50 px-3 py-2 text-xs font-semibold text-green-700">
                🏆 Итоги опубликованы — медали на странице события
              </p>
            ) : (
              <button
                className="btn btn-accent mt-3 w-full"
                onClick={publishResults}
                disabled={publishBusy}
                title="Опубликовать медали и уведомить участников"
              >
                {publishBusy ? "Публикуем…" : "🏆 Опубликовать итоги"}
              </button>
            )}
          </div>

          {/* Экспорт */}
          <div>
            <p className="text-sm font-bold">Экспорт</p>
            <div className="mt-3 grid gap-2">
              <button className="btn btn-ghost w-full" onClick={exportRegistrations}>
                ⬇ Заявки (XLSX)
              </button>
              {isCaseFormat && (
                <button className="btn btn-ghost w-full" onClick={exportResults}>
                  ⬇ Итоги и баллы (XLSX)
                </button>
              )}
            </div>
            <p className="muted mt-2 text-xs">
              Файлы скачиваются сразу в браузер.
            </p>
          </div>
        </div>
      </section>

      {/* Теги */}
      <section className="mt-6">
        <div className="card p-5 md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold">Темы мероприятия</h2>
              <p className="muted mt-0.5">
                До 4 тем — по ним событие находится в умной ленте
              </p>
            </div>
            <span className="badge badge-navy">
              выбрано: {eventTagIds.size}
            </span>
          </div>
          <div className="mt-4">
            <TagChips
              tags={tagsQuery.result.data ?? []}
              selected={eventTagIds}
              onToggle={toggleEventTag}
            />
          </div>
        </div>
      </section>

      {/* Аналитика */}
      <section className="mt-10">
        <h2 className="h2 mb-4">Аналитика</h2>
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="card p-5">
            <p className="text-sm font-bold">Заявки по дням (14 дней)</p>
            <div className="mt-4 h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={regsByDay}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef1f6" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="#9aa5b5" />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="#9aa5b5" width={28} />
                  <Tooltip />
                  <Bar dataKey="count" name="Заявок" fill="#16305f" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card p-5">
            <p className="text-sm font-bold">Активность судей (оценок на судью)</p>
            <div className="mt-4 h-52">
              {judgesActivity.length === 0 ? (
                <p className="flex h-full items-center justify-center text-sm text-muted">
                  Оценок пока нет
                </p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={judgesActivity} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef1f6" />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} stroke="#9aa5b5" />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} stroke="#9aa5b5" width={90} />
                    <Tooltip />
                    <Bar dataKey="count" name="Оценок" fill="#f0a828" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

        <div className="card mt-5 p-5">
          <p className="text-sm font-bold">Воронка мероприятия</p>
          <div className="mt-4 space-y-3">
            {[
              { label: "Заявки подано", value: regs.length, max: Math.max(regs.length, 1), color: "#16305f" },
              { label: "Одобрено", value: approved, max: Math.max(regs.length, 1), color: "#2a5099" },
              { label: "Решений сдано", value: solutions.length, max: Math.max(regs.length, 1), color: "#f0a828" },
            ].map((row) => (
              <div key={row.label}>
                <div className="flex justify-between text-sm">
                  <span className="text-muted">{row.label}</span>
                  <span className="font-bold">{row.value}</span>
                </div>
                <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.round((row.value / row.max) * 100)}%`,
                      backgroundColor: row.color,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Registrations */}
      <section className="mt-10">
        <h2 className="h2 mb-4">
          {isCaseFormat ? "Заявки команд" : "Записавшиеся участники"}
        </h2>
        <div className="card overflow-hidden">
          {regsQuery.query.isLoading ? (
            <Spinner />
          ) : regs.length === 0 ? (
            <p className="p-6 muted">Заявок пока нет.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-navy-800 text-left text-white">
                    <th className="px-5 py-3 font-semibold">Участник</th>
                    {isCaseFormat && (
                      <>
                        <th className="px-5 py-3 font-semibold">Команда</th>
                        <th className="px-5 py-3 font-semibold">Кейс</th>
                      </>
                    )}
                    <th className="px-5 py-3 font-semibold">Контакт</th>
                    <th className="px-5 py-3 font-semibold">Статус</th>
                    <th className="px-5 py-3 text-right font-semibold">
                      Действия
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {regs.map((reg) => {
                    const profile = profiles.get(reg.user_id);
                    return (
                      <tr
                        key={reg.id}
                        className="border-t border-slate-100 hover:bg-slate-50/70"
                      >
                        <td className="px-5 py-4 font-semibold">
                          {profile?.full_name || "Без имени"}
                          <span className="muted block text-xs font-normal">
                            {profile?.email}
                          </span>
                        </td>
                        {isCaseFormat && (
                          <>
                            <td className="px-5 py-4">
                              {reg.team_id
                                ? teams.get(reg.team_id)?.name
                                : "—"}
                            </td>
                            <td className="px-5 py-4 text-muted">
                              {reg.case_id
                                ? cases.get(reg.case_id)?.title
                                : "—"}
                            </td>
                          </>
                        )}
                        <td className="px-5 py-4 text-muted">
                          {reg.contact || "—"}
                        </td>
                        <td className="px-5 py-4">
                          <StatusBadge status={reg.status} />
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex justify-end gap-2">
                            {reg.status !== "approved" && (
                              <button
                                className="btn btn-success !px-3 !py-1.5"
                                onClick={() => setRegStatus(reg.id, "approved")}
                              >
                                Одобрить
                              </button>
                            )}
                            {reg.status !== "rejected" && (
                              <button
                                className="btn btn-danger !px-3 !py-1.5"
                                onClick={() => setRegStatus(reg.id, "rejected")}
                              >
                                Отклонить
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Solutions */}
      {isCaseFormat && (
        <section className="mt-10">
          <h2 className="h2 mb-4">Решения команд</h2>
          <div className="grid gap-4">
            {solutionsQuery.query.isLoading ? (
              <Spinner />
            ) : solutions.length === 0 ? (
              <div className="card p-6 muted">
                Команды ещё не загрузили решения.
              </div>
            ) : (
              solutions.map((sol) => (
                <div
                  key={sol.id}
                  className="card flex flex-col gap-4 p-5 md:flex-row md:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">{sol.title}</span>
                      <StatusBadge status={sol.status} />
                    </div>
                    <p className="muted mt-1">
                      {sol.team_name || "Без команды"}
                      {sol.case_title ? ` · ${sol.case_title}` : ""}
                    </p>
                    {sol.description && (
                      <p className="mt-2 line-clamp-2 text-sm text-slate-700">
                        {sol.description}
                      </p>
                    )}
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
                  <div className="flex gap-2">
                    {sol.file_path && (
                      <a
                        className="btn btn-ghost"
                        href={solutionFileUrl(sol.file_path) ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Файл решения
                      </a>
                    )}
                    <Link
                      href={`/judge/review/${sol.id}`}
                      className="btn btn-primary"
                    >
                      Оценить
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {/* Judges */}
      <section className="mt-10">
        <h2 className="h2 mb-1">Судьи мероприятия</h2>
        <p className="muted mb-4">
          Вы — судья этого мероприятия по умолчанию. Добавленные пользователи
          получают права судьи после того, как подтвердят приглашение.
        </p>

        <form onSubmit={addJudge} className="card flex flex-col gap-3 p-5 sm:flex-row">
          <input
            className="input"
            type="email"
            required
            placeholder="E-mail пользователя на портале"
            value={judgeEmail}
            onChange={(e) => setJudgeEmail(e.target.value)}
          />
          <button className="btn btn-primary" disabled={judgeBusy}>
            {judgeBusy ? "Добавляем…" : "Пригласить судьёй"}
          </button>
        </form>

        <div className="mt-4 grid gap-3">
          {judgesQuery.query.isLoading ? null : judges.length === 0 ? (
            <div className="card p-5 muted">
              Дополнительных судей пока нет — все работы оцениваете вы.
            </div>
          ) : (
            judges.map((j) => {
              const profile = profiles.get(j.user_id);
              return (
                <div
                  key={j.user_id}
                  className="card flex items-center justify-between gap-4 p-4"
                >
                  <div>
                    <p className="font-semibold">
                      {profile?.full_name || "Пользователь"}
                    </p>
                    <p className="muted">{profile?.email}</p>
                  </div>
                  <StatusBadge status={j.status} />
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}

export default function EventAdminPage() {
  return (
    <Guard>
      <EventAdmin />
    </Guard>
  );
}
