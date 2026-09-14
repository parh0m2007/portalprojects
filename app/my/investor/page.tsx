"use client";

import { useEffect, useState } from "react";
import { useGetIdentity, useNotification } from "@refinedev/core";
import { supabaseClient } from "@/lib/supabase";
import type { Identity } from "@/lib/auth";
import { Guard } from "@/components/Guard";
import { Field, Spinner } from "@/components/ui";
import { INVESTOR_KIND_LABELS } from "@/components/inventors/shared";

type InvestorProfileRow = {
  user_id: string;
  kind: string;
  name: string;
  thesis: string;
  sectors: string[];
  ticket_min: number | null;
  ticket_max: number | null;
  website: string;
  status: string;
};

function InvestorProfileInner() {
  const { data: identity } = useGetIdentity<Identity | null>();
  const { open } = useNotification();
  const [profile, setProfile] = useState<InvestorProfileRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState("angel");
  const [name, setName] = useState("");
  const [thesis, setThesis] = useState("");
  const [sectorsRaw, setSectorsRaw] = useState("");
  const [ticketMin, setTicketMin] = useState("");
  const [ticketMax, setTicketMax] = useState("");
  const [website, setWebsite] = useState("");

  useEffect(() => {
    if (!identity) return;
    supabaseClient
      .from("investor_profiles")
      .select("*")
      .eq("user_id", identity.id)
      .maybeSingle()
      .then(({ data }) => {
        const row = (data as InvestorProfileRow) ?? null;
        setProfile(row);
        if (row) {
          setKind(row.kind);
          setName(row.name);
          setThesis(row.thesis);
          setSectorsRaw(row.sectors.join(", "));
          setTicketMin(row.ticket_min != null ? String(row.ticket_min) : "");
          setTicketMax(row.ticket_max != null ? String(row.ticket_max) : "");
          setWebsite(row.website);
        }
        setLoading(false);
      });
  }, [identity]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!identity) return;
    setSaving(true);
    setError(null);
    const values = {
      user_id: identity.id,
      kind,
      name: name.trim(),
      thesis,
      sectors: sectorsRaw.split(",").map((s) => s.trim()).filter(Boolean),
      ticket_min: ticketMin ? Number(ticketMin) || null : null,
      ticket_max: ticketMax ? Number(ticketMax) || null : null,
      website: website.trim(),
    };
    try {
      const { error } = await supabaseClient
        .from("investor_profiles")
        .upsert(values, { onConflict: "user_id" });
      if (error) throw error;

      // Эмбеддинг тезиса для матчинга с изобретениями
      if (thesis.trim()) {
        try {
          const res = await fetch("/api/embed", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: `${name}\n${thesis}` }),
          });
          if (res.ok) {
            const { embedding } = await res.json();
            if (Array.isArray(embedding)) {
              await supabaseClient
                .from("investor_profiles")
                .update({ embedding })
                .eq("user_id", identity.id);
            }
          }
        } catch {
          /* матчинг по секторам работает и без эмбеддинга */
        }
      }

      open?.({
        type: "success",
        message: profile ? "Профиль обновлён" : "Профиль отправлен на модерацию",
        description: profile
          ? undefined
          : "Союз проверит профиль — после одобрения вы увидите закрытые изобретения.",
      });
    } catch (err) {
      setError((err as { message?: string })?.message ?? "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner />;

  return (
    <div className="container-page max-w-3xl py-10">
      <h1 className="h1">Профиль инвестора</h1>
      <p className="muted mt-1">
        По тезису и сферам портал подбирает вам подходящие изобретения, в том
        числе закрытые до патентования.
      </p>
      {profile && (
        <p className="meta mt-2">
          Статус модерации:{" "}
          {profile.status === "approved"
            ? "одобрен"
            : profile.status === "blocked"
              ? "заблокирован"
              : "на рассмотрении"}
        </p>
      )}

      <form onSubmit={save} className="mt-6 space-y-6">
        <div className="card space-y-5 p-6 md:p-8">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Тип">
              <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
                {Object.entries(INVESTOR_KIND_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Название / имя">
              <input
                className="input"
                placeholder="Например: Фонд «Сколково Вентурс»"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Инвестиционный тезис" hint="Что ищете, на какой стадии, с какой добавленной ценностью">
            <textarea
              className="input min-h-24"
              value={thesis}
              onChange={(e) => setThesis(e.target.value)}
            />
          </Field>

          <Field label="Сферы" hint="Через запятую: энергетика, робототехника, биотех">
            <input
              className="input"
              value={sectorsRaw}
              onChange={(e) => setSectorsRaw(e.target.value)}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Чек от, ₽">
              <input
                className="input"
                type="number"
                min={0}
                value={ticketMin}
                onChange={(e) => setTicketMin(e.target.value)}
              />
            </Field>
            <Field label="Чек до, ₽">
              <input
                className="input"
                type="number"
                min={0}
                value={ticketMax}
                onChange={(e) => setTicketMax(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Сайт">
            <input
              className="input"
              placeholder="https://…"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </Field>
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="card p-6">
          <button type="submit" disabled={saving} className="btn btn-primary">
            {saving ? "Сохранение…" : "Сохранить профиль"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function MyInvestorProfilePage() {
  return (
    <Guard>
      <InvestorProfileInner />
    </Guard>
  );
}
