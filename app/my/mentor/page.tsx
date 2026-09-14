"use client";

import { useEffect, useState } from "react";
import { useGetIdentity, useNotification } from "@refinedev/core";
import { supabaseClient } from "@/lib/supabase";
import type { Identity } from "@/lib/auth";
import { Guard } from "@/components/Guard";
import { Field, Spinner } from "@/components/ui";

type MentorProfileRow = {
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

function MentorProfileInner() {
  const { data: identity } = useGetIdentity<Identity | null>();
  const { open } = useNotification();
  const [profile, setProfile] = useState<MentorProfileRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [bio, setBio] = useState("");
  const [expertiseRaw, setExpertiseRaw] = useState("");
  const [experienceYears, setExperienceYears] = useState("");
  const [capacity, setCapacity] = useState("3");
  const [format, setFormat] = useState("online");
  const [city, setCity] = useState("");

  useEffect(() => {
    if (!identity) return;
    supabaseClient
      .from("mentor_profiles")
      .select("*")
      .eq("user_id", identity.id)
      .maybeSingle()
      .then(({ data }) => {
        const row = (data as MentorProfileRow) ?? null;
        setProfile(row);
        if (row) {
          setTitle(row.title);
          setBio(row.bio);
          setExpertiseRaw(row.expertise.join(", "));
          setExperienceYears(
            row.experience_years != null ? String(row.experience_years) : "",
          );
          setCapacity(String(row.capacity));
          setFormat(row.format);
          setCity(row.city);
        }
        setLoading(false);
      });
  }, [identity]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!identity) return;
    setSaving(true);
    setError(null);
    try {
      const { error } = await supabaseClient.from("mentor_profiles").upsert(
        {
          user_id: identity.id,
          title: title.trim(),
          bio,
          expertise: expertiseRaw.split(",").map((s) => s.trim()).filter(Boolean),
          experience_years: experienceYears ? Number(experienceYears) || null : null,
          capacity: Math.max(1, Number(capacity) || 3),
          format,
          city: city.trim(),
        },
        { onConflict: "user_id" },
      );
      if (error) throw error;
      open?.({
        type: "success",
        message: profile ? "Профиль обновлён" : "Профиль отправлен на модерацию",
        description: profile
          ? undefined
          : "Союз проверит профиль — после одобрения вы появитесь в каталоге.",
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
      <h1 className="h1">Профиль наставника</h1>
      <p className="muted mt-1">
        Программа «Наставники» Союза: ведите изобретателей от идеи до патента
        и рынка. Укажите, сколько менти готовы вести одновременно.
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
          <Field label="Титул" hint="Например: патентовед, к.т.н., 12 заявок в Роспатент">
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>

          <Field label="О себе">
            <textarea
              className="input min-h-24"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
            />
          </Field>

          <Field label="Экспертиза" hint="Через запятую: патентование, ТРИЗ, промышленный дизайн">
            <input
              className="input"
              value={expertiseRaw}
              onChange={(e) => setExpertiseRaw(e.target.value)}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Лет опыта">
              <input
                className="input"
                type="number"
                min={0}
                value={experienceYears}
                onChange={(e) => setExperienceYears(e.target.value)}
              />
            </Field>
            <Field label="Мест для менти">
              <input
                className="input"
                type="number"
                min={1}
                max={20}
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Формат">
              <select className="input" value={format} onChange={(e) => setFormat(e.target.value)}>
                <option value="online">Онлайн</option>
                <option value="offline">Очно</option>
              </select>
            </Field>
            <Field label="Город">
              <input
                className="input"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </Field>
          </div>
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

export default function MyMentorProfilePage() {
  return (
    <Guard>
      <MentorProfileInner />
    </Guard>
  );
}
