"use client";

import Link from "next/link";
import { useState } from "react";
import { useCreate, useGetIdentity, useNotification, useList } from "@refinedev/core";
import { useRouter } from "next/navigation";
import { COVERS_BUCKET, supabaseClient } from "@/lib/supabase";
import type { Identity } from "@/lib/auth";
import { Field } from "@/components/ui";
import { TagChips, type Tag } from "@/components/TagChips";
import { Guard } from "@/components/Guard";

type CaseDraft = { title: string; description: string };
type CriterionDraft = { title: string; max_score: number };

const DEFAULT_CRITERIA: CriterionDraft[] = [
  { title: "Техническая сложность", max_score: 10 },
  { title: "Качество решения кейса", max_score: 10 },
  { title: "Оформление и защита", max_score: 5 },
];

function NewEventForm() {
  const router = useRouter();
  const { open } = useNotification();
  const { data: identity } = useGetIdentity<Identity | null>();
  const { mutateAsync: create } = useCreate();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [format, setFormat] = useState<"case" | "lecture">("case");
  const [place, setPlace] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [deadline, setDeadline] = useState("");
  const [cases, setCases] = useState<CaseDraft[]>([
    { title: "", description: "" },
  ]);
  const [criteria, setCriteria] = useState<CriterionDraft[]>(DEFAULT_CRITERIA);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [blindJudging, setBlindJudging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tagsQuery = useList<Tag>({
    resource: "tags",
    sorters: [{ field: "sort_order", order: "asc" }],
    pagination: { pageSize: 100 },
  });

  function toggleTag(tagId: string) {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) {
        next.delete(tagId);
      } else if (next.size < 4) {
        next.add(tagId);
      }
      return next;
    });
  }

  function pickCover(file: File | null) {
    setCoverFile(file);
    setCoverPreview(file ? URL.createObjectURL(file) : null);
  }

  function updateCase(i: number, patch: Partial<CaseDraft>) {
    setCases((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function updateCriterion(i: number, patch: Partial<CriterionDraft>) {
    setCriteria((prev) =>
      prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!identity) return;
    if (format === "case") {
      const filledCases = cases.filter((c) => c.title.trim());
      if (filledCases.length === 0) {
        setError("Добавьте хотя бы один кейс с названием");
        return;
      }
    }

    setSaving(true);
    try {
      const { data: event } = await create({
        resource: "events",
        values: {
          title: title.trim(),
          description,
          format,
          place,
          author_id: identity.id,
          status: "published",
          blind_judging: blindJudging,
          starts_at: startsAt ? new Date(startsAt).toISOString() : null,
          registration_deadline: deadline
            ? new Date(deadline).toISOString()
            : null,
        },
      });
      const eventId = (event as { id?: string } | undefined)?.id;
      if (!eventId) throw new Error("Не удалось создать мероприятие");

      if (coverFile) {
        const path = `${eventId}/${Date.now()}-${coverFile.name}`;
        const { error: upErr } = await supabaseClient.storage
          .from(COVERS_BUCKET)
          .upload(path, coverFile, { upsert: true });
        if (!upErr) {
          await supabaseClient
            .from("events")
            .update({ cover_path: path })
            .eq("id", eventId);
        }
      }

      if (selectedTags.size > 0) {
        await supabaseClient.from("event_tags").insert(
          [...selectedTags].map((tagId) => ({ event_id: eventId, tag_id: tagId })),
        );
      }

      // Нейро-эмбеддинг для умной ленты (не критично, если Ollama выключена)
      try {
        const res = await fetch("/api/embed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: `${title}\n${description}` }),
        });
        if (res.ok) {
          const { embedding } = await res.json();
          if (Array.isArray(embedding)) {
            await supabaseClient
              .from("events")
              .update({ embedding })
              .eq("id", eventId);
          }
        }
      } catch {
        /* лента работает и без эмбеддинга */
      }

      if (format === "case") {
        const filledCases = cases.filter((c) => c.title.trim());
        for (const c of filledCases) {
          await create({
            resource: "cases",
            values: { event_id: eventId, title: c.title.trim(), description: c.description },
          });
        }
        const filledCriteria = criteria.filter((c) => c.title.trim());
        for (let i = 0; i < filledCriteria.length; i++) {
          await create({
            resource: "criteria",
            values: {
              event_id: eventId,
              title: filledCriteria[i].title.trim(),
              max_score: Math.max(1, Number(filledCriteria[i].max_score) || 10),
              sort_order: i,
            },
          });
        }
      }

      open?.({
        type: "success",
        message: "Мероприятие создано",
        description: "Оно опубликовано в витрине и открыто для заявок.",
      });
      router.push(`/my/events/${eventId}`);
    } catch (err) {
      setError(
        (err as { message?: string })?.message ?? "Не удалось создать мероприятие",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container-page max-w-3xl py-10">
      <h1 className="h1">Новое мероприятие</h1>
      <p className="muted mt-1">
        Кейс-чемпионат — с кейсами, командами и оценкой судей. Лекция — простая
        запись участников.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-6">
        <div className="card space-y-5 p-6 md:p-8">
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                {
                  value: "case" as const,
                  title: "Кейс-чемпионат",
                  text: "Команды выбирают кейс и загружают решения, судьи ставят баллы",
                },
                {
                  value: "lecture" as const,
                  title: "Лекция",
                  text: "Простая запись участников без команд и кейсов",
                },
              ]
            ).map((opt) => (
              <label
                key={opt.value}
                className={`cursor-pointer rounded-xl border p-4 transition ${
                  format === opt.value
                    ? "border-navy-800 bg-navy-50 ring-2 ring-navy-800/15"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <input
                  type="radio"
                  className="sr-only"
                  checked={format === opt.value}
                  onChange={() => setFormat(opt.value)}
                />
                <span className="block font-bold">{opt.title}</span>
                <span className="muted mt-1 block text-xs leading-relaxed">
                  {opt.text}
                </span>
              </label>
            ))}
          </div>

          <Field label="Темы" hint="До 4 тем — по ним пользователи найдут событие в умной ленте">
            <TagChips
              tags={tagsQuery.result.data ?? []}
              selected={selectedTags}
              onToggle={toggleTag}
            />
          </Field>

          <Field label="Обложка" hint="JPEG или PNG — будет показана вместо градиента">
            <div className="flex items-center gap-4">
              {coverPreview ? (
                <img
                  src={coverPreview}
                  alt="Превью обложки"
                  className="h-20 w-36 rounded-xl border border-slate-200 object-cover"
                />
              ) : (
                <div className="flex h-20 w-36 items-center justify-center rounded-xl border border-dashed border-slate-300 text-xs text-muted">
                  Нет файла
                </div>
              )}
              <label className="btn btn-ghost cursor-pointer">
                Выбрать файл
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => pickCover(e.target.files?.[0] ?? null)}
                />
              </label>
              {coverFile && (
                <button
                  type="button"
                  className="text-sm font-semibold text-rose-600 hover:underline"
                  onClick={() => pickCover(null)}
                >
                  Убрать
                </button>
              )}
            </div>
          </Field>

          {format === "case" && (
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-4">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={blindJudging}
                onChange={(e) => setBlindJudging(e.target.checked)}
              />
              <span>
                <span className="block font-bold">Слепое судейство</span>
                <span className="muted mt-1 block text-xs leading-relaxed">
                  Судьи не видят названия команд до публикации итогов —
                  честная оценка без предвзятости.
                </span>
              </span>
            </label>
          )}

          <Field label="Название" required>
            <input
              className="input"
              required
              placeholder="Хакатон «Инженерия города»"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>

          <Field label="Описание">
            <textarea
              className="input min-h-28"
              placeholder="О чём событие, кто может участвовать, что получат участники"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Место">
              <input
                className="input"
                placeholder="Технопарк, ул. Ленина 50"
                value={place}
                onChange={(e) => setPlace(e.target.value)}
              />
            </Field>
            <Field label="Начало">
              <input
                className="input"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </Field>
            <Field label="Приём заявок до">
              <input
                className="input"
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </Field>
          </div>
        </div>

        {format === "case" && (
          <>
            <div className="card space-y-4 p-6 md:p-8">
              <div className="flex items-center justify-between">
                <h2 className="h2">Кейсы</h2>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() =>
                    setCases((prev) => [...prev, { title: "", description: "" }])
                  }
                >
                  + Добавить кейс
                </button>
              </div>
              {cases.map((c, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-slate-200 p-4"
                >
                  <div className="flex items-center justify-between">
                    <span className="badge badge-navy">Кейс {i + 1}</span>
                    {cases.length > 1 && (
                      <button
                        type="button"
                        className="text-sm font-semibold text-rose-600 hover:underline"
                        onClick={() =>
                          setCases((prev) => prev.filter((_, idx) => idx !== i))
                        }
                      >
                        Удалить
                      </button>
                    )}
                  </div>
                  <input
                    className="input mt-3"
                    placeholder="Название кейса"
                    value={c.title}
                    onChange={(e) => updateCase(i, { title: e.target.value })}
                  />
                  <textarea
                    className="input mt-3 min-h-20"
                    placeholder="Что нужно сделать, критерии результата, ограничения"
                    value={c.description}
                    onChange={(e) =>
                      updateCase(i, { description: e.target.value })
                    }
                  />
                </div>
              ))}
            </div>

            <div className="card space-y-4 p-6 md:p-8">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="h2">Критерии оценки</h2>
                  <p className="muted mt-1">
                    По ним судьи будут выставлять баллы командам.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() =>
                    setCriteria((prev) => [
                      ...prev,
                      { title: "", max_score: 10 },
                    ])
                  }
                >
                  + Критерий
                </button>
              </div>
              {criteria.map((c, i) => (
                <div key={i} className="flex items-center gap-3">
                  <input
                    className="input"
                    placeholder={`Критерий ${i + 1}`}
                    value={c.title}
                    onChange={(e) =>
                      updateCriterion(i, { title: e.target.value })
                    }
                  />
                  <input
                    className="input w-28"
                    type="number"
                    min={1}
                    max={100}
                    title="Максимальный балл"
                    value={c.max_score}
                    onChange={(e) =>
                      updateCriterion(i, {
                        max_score: Number(e.target.value),
                      })
                    }
                  />
                  {criteria.length > 1 && (
                    <button
                      type="button"
                      className="text-sm font-semibold text-rose-600 hover:underline"
                      onClick={() =>
                        setCriteria((prev) =>
                          prev.filter((_, idx) => idx !== i),
                        )
                      }
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {error && (
          <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <button type="submit" className="btn btn-accent" disabled={saving}>
            {saving ? "Создаём…" : "Опубликовать мероприятие"}
          </button>
          <Link href="/my" className="btn btn-ghost">
            Отмена
          </Link>
        </div>
      </form>
    </div>
  );
}

export default function NewEventPage() {
  return (
    <Guard>
      <NewEventForm />
    </Guard>
  );
}
