"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useOne, useGetIdentity, useNotification } from "@refinedev/core";
import { supabaseClient } from "@/lib/supabase";
import type { Identity } from "@/lib/auth";
import { Guard } from "@/components/Guard";
import { Spinner, EmptyState, Field } from "@/components/ui";
import {
  STAGE_LABELS,
  VISIBILITY_LABELS,
  type InventionCard,
} from "@/components/inventors/shared";

function EditInventionInner() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { open } = useNotification();
  const { data: identity } = useGetIdentity<Identity | null>();

  const { result: inv, query } = useOne<InventionCard>({
    resource: "invention_cards",
    id,
  });

  if (query.isLoading) return <Spinner />;
  if (!inv || (identity && inv.author_id !== identity.id)) {
    return (
      <div className="container-page py-16">
        <EmptyState title="Изобретение недоступно" description="Редактировать может только автор." />
      </div>
    );
  }
  return <EditForm key={inv.id} inv={inv} />;
}

function EditForm({ inv }: { inv: InventionCard }) {
  const router = useRouter();
  const { open } = useNotification();

  const [title, setTitle] = useState(inv.title);
  const [summary, setSummary] = useState(inv.summary);
  const [description, setDescription] = useState(inv.description);
  const [stage, setStage] = useState(inv.stage);
  const [patentStatus, setPatentStatus] = useState(inv.patent_status);
  const [sectorsRaw, setSectorsRaw] = useState(inv.sectors.join(", "));
  const [fundingGoal, setFundingGoal] = useState(
    inv.funding_goal != null ? String(inv.funding_goal) : "",
  );
  const [visibility, setVisibility] = useState(inv.visibility);
  const [status, setStatus] = useState(inv.status);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const { error } = await supabaseClient
        .from("inventions")
        .update({
          title: title.trim(),
          summary: summary.trim(),
          description,
          stage,
          patent_status: patentStatus.trim(),
          sectors: sectorsRaw.split(",").map((s) => s.trim()).filter(Boolean),
          funding_goal: fundingGoal ? Number(fundingGoal) || null : null,
          visibility,
          status,
        })
        .eq("id", inv.id);
      if (error) throw error;
      open?.({ type: "success", message: "Сохранено" });
      router.push("/my/inventions");
    } catch (err) {
      open?.({
        type: "error",
        message: "Не удалось сохранить",
        description: (err as { message?: string })?.message,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container-page max-w-3xl py-10">
      <h1 className="h1">Редактирование изобретения</h1>

      <form onSubmit={save} className="mt-6 space-y-6">
        <div className="card space-y-5 p-6 md:p-8">
          <Field label="Название" required>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Краткое описание">
            <input className="input" value={summary} onChange={(e) => setSummary(e.target.value)} />
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
              <select className="input" value={stage} onChange={(e) => setStage(e.target.value)}>
                {Object.entries(STAGE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Патентный статус">
              <input
                className="input"
                value={patentStatus}
                onChange={(e) => setPatentStatus(e.target.value)}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Сферы" hint="Через запятую">
              <input className="input" value={sectorsRaw} onChange={(e) => setSectorsRaw(e.target.value)} />
            </Field>
            <Field label="Цель инвестиций, ₽">
              <input
                className="input"
                type="number"
                min={0}
                value={fundingGoal}
                onChange={(e) => setFundingGoal(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Видимость">
            <select
              className="input"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value)}
            >
              {Object.entries(VISIBILITY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Статус">
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="draft">Черновик</option>
              <option value="published">Опубликовано</option>
            </select>
          </Field>
        </div>
        <div className="card p-6">
          <button type="submit" disabled={saving} className="btn btn-primary">
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function EditInventionPage() {
  return (
    <Guard>
      <EditInventionInner />
    </Guard>
  );
}
