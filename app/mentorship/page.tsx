"use client";

import { useMemo, useState } from "react";
import {
  useList,
  useOne,
  useUpdate,
  useCreate,
  useGetIdentity,
  useNotification,
} from "@refinedev/core";
import { supabaseClient } from "@/lib/supabase";
import type { Identity } from "@/lib/auth";
import { Guard } from "@/components/Guard";
import { EmptyState, Spinner, StatusBadge } from "@/components/ui";
import type { InventionCard } from "@/components/inventors/shared";

type MentorProfile = {
  user_id: string;
  title: string;
  bio: string;
  expertise: string[];
  experience_years: number | null;
  capacity: number;
  format: string;
  city: string;
  status: string;
};

type MentorRequest = {
  id: string;
  mentor_id: string;
  mentee_id: string;
  invention_id: string | null;
  topic: string;
  message: string;
  status: string;
};

type MentorRelation = {
  id: string;
  mentor_id: string;
  mentee_id: string;
  invention_id: string | null;
  goals: string;
  status: string;
  started_at: string;
};

type ProfileRow = { id: string; full_name: string };

function MentorshipInner() {
  const { data: identity } = useGetIdentity<Identity | null>();
  const { open } = useNotification();
  const { mutateAsync: updateRequest } = useUpdate();
  const { mutateAsync: createRelation } = useCreate();
  const [search, setSearch] = useState("");
  // Форма заявки
  const [selectedMentor, setSelectedMentor] = useState<MentorProfile | null>(null);
  const [topic, setTopic] = useState("");
  const [message, setMessage] = useState("");
  const [inventionId, setInventionId] = useState("");
  const [busy, setBusy] = useState(false);

  const mentorsQuery = useList<MentorProfile>({
    resource: "mentor_profiles",
    sorters: [{ field: "created_at", order: "desc" }],
    pagination: { pageSize: 200 },
  });

  // Заявки к моим профилям: входящие (я наставник) и исходящие (я менти)
  const incomingQuery = useList<MentorRequest>({
    resource: "mentorship_requests",
    filters: [{ field: "mentor_id", operator: "eq", value: identity?.id ?? "" }],
    sorters: [{ field: "created_at", order: "desc" }],
    pagination: { pageSize: 100 },
    queryOptions: { enabled: !!identity?.id },
  });
  const outgoingQuery = useList<MentorRequest>({
    resource: "mentorship_requests",
    filters: [{ field: "mentee_id", operator: "eq", value: identity?.id ?? "" }],
    sorters: [{ field: "created_at", order: "desc" }],
    pagination: { pageSize: 100 },
    queryOptions: { enabled: !!identity?.id },
  });

  const relationsQuery = useList<MentorRelation>({
    resource: "mentorship_relations",
    sorters: [{ field: "started_at", order: "desc" }],
    pagination: { pageSize: 100 },
    queryOptions: { enabled: !!identity?.id },
  });

  const myInventionsQuery = useList<InventionCard>({
    resource: "invention_cards",
    filters: [{ field: "author_id", operator: "eq", value: identity?.id ?? "" }],
    pagination: { pageSize: 100 },
    queryOptions: { enabled: !!identity?.id },
  });

  const mentors = useMemo(() => {
    const all = mentorsQuery.result.data ?? [];
    return all
      .filter((m) => m.status === "approved" || m.user_id === identity?.id)
      .filter((m) => {
        const q = search.trim().toLowerCase();
        if (!q) return true;
        return (
          m.title.toLowerCase().includes(q) ||
          m.bio.toLowerCase().includes(q) ||
          m.expertise.some((e) => e.toLowerCase().includes(q))
        );
      });
  }, [mentorsQuery.result.data, search, identity?.id]);

  async function submitRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedMentor || !identity) return;
    setBusy(true);
    try {
      const { error } = await supabaseClient.from("mentorship_requests").insert({
        mentor_id: selectedMentor.user_id,
        mentee_id: identity.id,
        invention_id: inventionId || null,
        topic: topic.trim(),
        message: message.trim(),
      });
      if (error) throw error;
      open?.({
        type: "success",
        message: "Заявка отправлена",
        description: "Наставник получит уведомление.",
      });
      setSelectedMentor(null);
      setTopic("");
      setMessage("");
      setInventionId("");
      outgoingQuery.query.refetch();
    } catch (err) {
      open?.({
        type: "error",
        message: "Не удалось отправить заявку",
        description: (err as { message?: string })?.message,
      });
    } finally {
      setBusy(false);
    }
  }

  async function respond(req: MentorRequest, status: "accepted" | "declined") {
    try {
      await updateRequest({
        resource: "mentorship_requests",
        id: req.id,
        values: { status },
      });
      incomingQuery.query.refetch();
      relationsQuery.query.refetch();
      open?.({
        type: "success",
        message: status === "accepted" ? "Заявка принята" : "Заявка отклонена",
      });
    } catch (err) {
      open?.({
        type: "error",
        message: "Не удалось обновить заявку",
        description: (err as { message?: string })?.message,
      });
    }
  }

  async function closeRelation(rel: MentorRelation) {
    try {
      await updateRequest({ resource: "mentorship_relations", id: rel.id, values: { status: "closed" } });
      relationsQuery.query.refetch();
    } catch (err) {
      open?.({
        type: "error",
        message: "Не удалось закрыть связь",
        description: (err as { message?: string })?.message,
      });
    }
  }

  const incoming = incomingQuery.result.data ?? [];
  const outgoing = outgoingQuery.result.data ?? [];
  const relations = relationsQuery.result.data ?? [];

  return (
    <div className="container-page py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="h1">Наставничество</h1>
          <p className="muted mt-1">
            Опытные изобретатели и патентоведы помогают довести разработку до
            патента и рынка.
          </p>
        </div>
        <input
          className="input w-full sm:w-72"
          placeholder="Поиск по экспертизе"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Входящие заявки (я наставник) */}
      {incoming.length > 0 && (
        <section className="mt-8">
          <h2 className="h2">Заявки ко мне</h2>
          <div className="mt-4 space-y-3">
            {incoming.map((r) => (
              <div key={r.id} className="card flex flex-wrap items-center gap-4 p-5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold">{r.topic || "Без темы"}</p>
                  {r.message && <p className="muted mt-1 line-clamp-2 text-xs">{r.message}</p>}
                </div>
                <StatusBadge status={r.status} />
                {r.status === "pending" && (
                  <span className="flex gap-2">
                    <button onClick={() => respond(r, "accepted")} className="btn btn-primary !py-2 text-xs">
                      Принять
                    </button>
                    <button onClick={() => respond(r, "declined")} className="btn btn-ghost !py-2 text-xs">
                      Отклонить
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Активные связи */}
      {relations.length > 0 && (
        <section className="mt-8">
          <h2 className="h2">Мои связи</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {relations.map((rel) => (
              <RelationCard
                key={rel.id}
                rel={rel}
                identityId={identity?.id ?? ""}
                onClose={() => closeRelation(rel)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Исходящие заявки (я менти) */}
      {outgoing.length > 0 && (
        <section className="mt-8">
          <h2 className="h2">Мои заявки к наставникам</h2>
          <div className="mt-4 space-y-3">
            {outgoing.map((r) => (
              <div key={r.id} className="card flex flex-wrap items-center gap-4 p-5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold">{r.topic || "Без темы"}</p>
                  {r.message && <p className="muted mt-1 line-clamp-2 text-xs">{r.message}</p>}
                </div>
                <StatusBadge status={r.status} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Каталог наставников */}
      <section className="mt-10">
        <h2 className="h2">Каталог наставников</h2>
        {mentorsQuery.query.isLoading ? (
          <Spinner />
        ) : mentors.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title={search ? "Ничего не найдено" : "Наставников пока нет"}
              description={
                search
                  ? "Попробуйте изменить запрос."
                  : "Станьте первым наставником Союза или зайдите позже."
              }
            />
          </div>
        ) : (
          <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {mentors.map((m) => (
              <div key={m.user_id} className="card flex flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-display text-base font-bold leading-tight">
                      {m.title || "Наставник"}
                    </p>
                    <p className="meta mt-0.5">
                      {m.format === "online" ? "Онлайн" : "Очно"}
                      {m.city && ` · ${m.city}`}
                      {m.experience_years != null && ` · ${m.experience_years} лет опыта`}
                    </p>
                  </div>
                  <span className="badge badge-navy">{m.capacity} мест</span>
                </div>
                {m.bio && <p className="muted line-clamp-4 text-sm">{m.bio}</p>}
                {m.expertise.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {m.expertise.slice(0, 4).map((s) => (
                      <span
                        key={s}
                        className="border border-line px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-muted-ink"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-auto border-t border-line pt-3">
                  {m.user_id === identity?.id ? (
                    <span className="meta">Это ваш профиль</span>
                  ) : (
                    <button
                      onClick={() => {
                        setSelectedMentor(m);
                        setTopic("");
                        setMessage("");
                      }}
                      className="btn btn-primary w-full !py-2 text-xs"
                    >
                      Запросить наставничество
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Форма заявки */}
      {selectedMentor && (
        <form
          onSubmit={submitRequest}
          className="card sticky bottom-4 z-10 mt-6 space-y-4 border-2 border-ink p-6 shadow-[6px_6px_0_0_var(--color-line)]"
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold">
              Заявка наставнику: {selectedMentor.title || "Наставник"}
            </p>
            <button
              type="button"
              onClick={() => setSelectedMentor(null)}
              className="meta hover:text-ink"
            >
              Отменить
            </button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Тема</label>
              <input
                className="input"
                placeholder="Например: патентование промышленного образца"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Контекст (необязательно)</label>
              <select
                className="input"
                value={inventionId}
                onChange={(e) => setInventionId(e.target.value)}
              >
                <option value="">— без изобретения —</option>
                {(myInventionsQuery.result.data ?? []).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Сообщение</label>
            <textarea
              className="input min-h-24"
              placeholder="Чем можете поделиться, какая помощь нужна"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          <button type="submit" disabled={busy} className="btn btn-accent">
            {busy ? "Отправка…" : "Отправить заявку"}
          </button>
        </form>
      )}
    </div>
  );
}

function RelationCard({
  rel,
  identityId,
  onClose,
}: {
  rel: MentorRelation;
  identityId: string;
  onClose: () => void;
}) {
  const counterpartId = rel.mentor_id === identityId ? rel.mentee_id : rel.mentor_id;
  const profileQuery = useOne<ProfileRow>({
    resource: "profiles",
    id: counterpartId,
    queryOptions: { enabled: !!counterpartId },
  });
  const name = profileQuery.result?.full_name ?? "…";
  const role = rel.mentor_id === identityId ? "менти" : "наставник";

  return (
    <div className="card space-y-3 p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold">{name}</p>
          <p className="meta">
            {role} · с{" "}
            {new Date(rel.started_at).toLocaleDateString("ru-RU", {
              day: "numeric",
              month: "short",
              year: "2-digit",
            })}
          </p>
        </div>
        <StatusBadge status={rel.status === "active" ? "accepted" : "closed"} />
      </div>
      {rel.goals && <p className="muted line-clamp-2 text-xs">{rel.goals}</p>}
      <div className="flex gap-2">
        <a href={`/mentorship/${rel.id}`} className="btn btn-ghost !py-1.5 text-xs">
          Журнал
        </a>
        {rel.status === "active" && (
          <button onClick={onClose} className="btn btn-ghost !py-1.5 text-xs">
            Закрыть
          </button>
        )}
      </div>
    </div>
  );
}

export default function MentorshipPage() {
  return (
    <Guard>
      <MentorshipInner />
    </Guard>
  );
}
