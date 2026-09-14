"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useOne, useList, useCreate, useGetIdentity, useNotification } from "@refinedev/core";
import type { Identity } from "@/lib/auth";
import { Guard } from "@/components/Guard";
import { EmptyState, Spinner } from "@/components/ui";

type Relation = {
  id: string;
  mentor_id: string;
  mentee_id: string;
  invention_id: string | null;
  goals: string;
  status: string;
  started_at: string;
};

type Note = {
  id: string;
  relation_id: string;
  author_id: string;
  content: string;
  next_steps: string;
  created_at: string;
};

type ProfileRow = { id: string; full_name: string };

function NotesInner() {
  const { id } = useParams<{ id: string }>();
  const { data: identity } = useGetIdentity<Identity | null>();
  const { open } = useNotification();
  const { mutateAsync: createNote } = useCreate();
  const [content, setContent] = useState("");
  const [nextSteps, setNextSteps] = useState("");
  const [busy, setBusy] = useState(false);

  const { result: rel, query } = useOne<Relation>({
    resource: "mentorship_relations",
    id,
  });

  const notesQuery = useList<Note>({
    resource: "mentorship_notes",
    filters: [{ field: "relation_id", operator: "eq", value: id }],
    sorters: [{ field: "created_at", order: "desc" }],
    pagination: { pageSize: 200 },
  });

  const counterpartId =
    rel && identity
      ? rel.mentor_id === identity.id
        ? rel.mentee_id
        : rel.mentor_id
      : null;

  const profileQuery = useOne<ProfileRow>({
    resource: "profiles",
    id: counterpartId ?? "",
    queryOptions: { enabled: !!counterpartId },
  });

  async function submitNote(e: React.FormEvent) {
    e.preventDefault();
    if (!identity || !content.trim()) return;
    setBusy(true);
    try {
      await createNote({
        resource: "mentorship_notes",
        values: {
          relation_id: id,
          author_id: identity.id,
          content: content.trim(),
          next_steps: nextSteps.trim(),
        },
      });
      setContent("");
      setNextSteps("");
      notesQuery.query.refetch();
    } catch (err) {
      open?.({
        type: "error",
        message: "Не удалось сохранить запись",
        description: (err as { message?: string })?.message,
      });
    } finally {
      setBusy(false);
    }
  }

  if (query.isLoading) return <Spinner />;
  if (!rel) {
    return (
      <div className="container-page py-16">
        <EmptyState title="Связь не найдена" />
      </div>
    );
  }

  const notes = notesQuery.result.data ?? [];
  const isMine =
    !!identity && (rel.mentor_id === identity.id || rel.mentee_id === identity.id);

  if (!isMine) {
    return (
      <div className="container-page py-16">
        <EmptyState title="Нет доступа" description="Журнал виден только участникам связи." />
      </div>
    );
  }

  return (
    <div className="container-page max-w-3xl py-10">
      <Link href="/mentorship" className="meta hover:text-ink">
        ← Наставничество
      </Link>

      <div className="mt-4">
        <h1 className="h1">
          Связь с {profileQuery.result?.full_name ?? "…"}
        </h1>
        <p className="muted mt-1">
          {rel.goals || "Без темы"} · с{" "}
          {new Date(rel.started_at).toLocaleDateString("ru-RU", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
          {rel.status === "closed" && " · закрыта"}
        </p>
      </div>

      {/* Форма новой записи */}
      {rel.status === "active" && (
        <form onSubmit={submitNote} className="card mt-6 space-y-4 p-6">
          <div>
            <label className="label">Что обсуждали</label>
            <textarea
              className="input min-h-20"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Следующие шаги</label>
            <input
              className="input"
              value={nextSteps}
              onChange={(e) => setNextSteps(e.target.value)}
            />
          </div>
          <button type="submit" disabled={busy || !content.trim()} className="btn btn-primary">
            {busy ? "Сохранение…" : "Добавить запись"}
          </button>
        </form>
      )}

      {/* Журнал */}
      {notes.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Записей пока нет"
            description="Фиксируйте итоги сессий и договорённости — журнал видят только вы двое."
          />
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {notes.map((n) => (
            <article key={n.id} className="card space-y-2 p-5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold">
                  {n.author_id === identity?.id ? "Вы" : (profileQuery.result?.full_name ?? "…")}
                </p>
                <span className="meta">
                  {new Date(n.created_at).toLocaleString("ru-RU", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <p className="whitespace-pre-line text-sm">{n.content}</p>
              {n.next_steps && (
                <p className="border-t border-line pt-2 text-xs">
                  <span className="font-bold">Дальше: </span>
                  {n.next_steps}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export default function RelationNotesPage() {
  return (
    <Guard>
      <NotesInner />
    </Guard>
  );
}
