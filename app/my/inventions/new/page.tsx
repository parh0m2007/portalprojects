"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useCreate, useGetIdentity, useNotification } from "@refinedev/core";
import { supabaseClient } from "@/lib/supabase";
import type { Identity } from "@/lib/auth";
import { Guard } from "@/components/Guard";
import { Field } from "@/components/ui";
import {
  STAGE_LABELS,
  VISIBILITY_LABELS,
  type InventionCard,
} from "@/components/inventors/shared";

const PITCH_BUCKET = "inventions";

function NewInventionInner() {
  const router = useRouter();
  const { open } = useNotification();
  const { data: identity } = useGetIdentity<Identity | null>();
  const { mutateAsync: create } = useCreate();

  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [stage, setStage] = useState("idea");
  const [patentStatus, setPatentStatus] = useState("");
  const [sectorsRaw, setSectorsRaw] = useState("");
  const [fundingGoal, setFundingGoal] = useState("");
  const [visibility, setVisibility] = useState("investors_only");
  const [pitchFile, setPitchFile] = useState<File | null>(null);
  const [publish, setPublish] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!identity) return;
    if (!title.trim()) {
      setError("Укажите название");
      return;
    }
    setSaving(true);
    try {
      const { data: inv, error: invErr } = await supabaseClient
        .from("inventions")
        .insert({
          author_id: identity.id,
          title: title.trim(),
          summary: summary.trim(),
          description,
          stage,
          patent_status: patentStatus.trim(),
          sectors: sectorsRaw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          funding_goal: fundingGoal ? Number(fundingGoal) || null : null,
          visibility,
          status: publish ? "published" : "draft",
        })
        .select("id")
        .single();
      if (invErr) throw invErr;

      if (pitchFile) {
        const path = `${inv.id}/${Date.now()}-${pitchFile.name}`;
        const { error: upErr } = await supabaseClient.storage
          .from(PITCH_BUCKET)
          .upload(path, pitchFile, { upsert: true });
        if (!upErr) {
          await supabaseClient
            .from("inventions")
            .update({ pitch_path: path })
            .eq("id", inv.id);
        }
      }

      // Эмбеддинг для матчинга с инвесторами (не критично)
      try {
        const res = await fetch("/api/embed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: `${title}\n${summary}\n${description}` }),
        });
        if (res.ok) {
          const { embedding } = await res.json();
          if (Array.isArray(embedding)) {
            await supabaseClient
              .from("inventions")
              .update({ embedding })
              .eq("id", inv.id);
          }
        }
      } catch {
        /* матчинг по секторам работает и без эмбеддинга */
      }

      open?.({
        type: "success",
        message: publish ? "Изобретение опубликовано" : "Черновик сохранён",
        description: publish
          ? visibility === "public"
            ? "Оно публично видно в витрине."
            : "Его видят только одобренные инвесторы и вы."
          : "Опубликуйте, когда будете готовы.",
      });
      router.push("/my/inventions");
    } catch (err) {
      setError((err as { message?: string })?.message ?? "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container-page max-w-3xl py-10">
      <h1 className="h1">Новое изобретение</h1>
      <p className="muted mt-1">
        Опишите разработку: стадию, патентный статус и цель инвестиций —
        по этому портрету портал подберёт инвесторов.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-6">
        <div className="card space-y-5 p-6 md:p-8">
          <Field label="Название" required>
            <input
              className="input"
              placeholder="Например: Модульный солнечный концентратор"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>

          <Field label="Краткое описание" hint="1–2 предложения для карточки в витрине">
            <input
              className="input"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </Field>

          <Field label="Подробное описание">
            <textarea
              className="input min-h-32"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Стадия">
              <select
                className="input"
                value={stage}
                onChange={(e) => setStage(e.target.value)}
              >
                {Object.entries(STAGE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Патентный статус" hint="Например: заявка №2024143210 от 01.09.2026">
              <input
                className="input"
                value={patentStatus}
                onChange={(e) => setPatentStatus(e.target.value)}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Сферы" hint="Через запятую: энергетика, экология, IoT">
              <input
                className="input"
                value={sectorsRaw}
                onChange={(e) => setSectorsRaw(e.target.value)}
              />
            </Field>
            <Field label="Цель инвестиций, ₽" hint="Пусто — инвестиции не ищете">
              <input
                className="input"
                type="number"
                min={0}
                value={fundingGoal}
                onChange={(e) => setFundingGoal(e.target.value)}
              />
            </Field>
          </div>

          <Field
            label="Видимость"
            hint="«Только инвесторам» — безопасный вариант до получения патента: работа не видна публично и не лишает новизны"
          >
            <div className="space-y-2">
              {(["investors_only", "public", "private"] as const).map((v) => (
                <label key={v} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="visibility"
                    value={v}
                    checked={visibility === v}
                    onChange={() => setVisibility(v)}
                  />
                  {VISIBILITY_LABELS[v]}
                </label>
              ))}
            </div>
          </Field>

          <Field label="Питч-дек" hint="PDF или презентация; доступ по подписанной ссылке только с карточки">
            <input
              type="file"
              accept=".pdf,.ppt,.pptx,.odp"
              className="input"
              onChange={(e) => setPitchFile(e.target.files?.[0] ?? null)}
            />
          </Field>
        </div>

        <div className="card space-y-4 p-6">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={publish}
              onChange={(e) => setPublish(e.target.checked)}
            />
            Опубликовать сразу (иначе — черновик)
          </label>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <button type="submit" disabled={saving} className="btn btn-primary">
            {saving ? "Сохранение…" : publish ? "Опубликовать" : "Сохранить черновик"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function NewInventionPage() {
  return (
    <Guard>
      <NewInventionInner />
    </Guard>
  );
}
