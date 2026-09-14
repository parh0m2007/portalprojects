"use client";

// Общие константы и типы модуля «Союз изобретателей»

export type InventionCard = {
  id: string;
  author_id: string;
  title: string;
  summary: string;
  description: string;
  stage: string;
  patent_status: string;
  sectors: string[];
  funding_goal: number | null;
  pitch_path: string | null;
  event_id: string | null;
  visibility: string;
  status: string;
  created_at: string;
  author_name: string;
  event_title: string | null;
  contacts_count: number;
};

export type InvestorProfile = {
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

export type MentorProfile = {
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

export const STAGE_LABELS: Record<string, string> = {
  idea: "Идея",
  prototype: "Прототип",
  mvp: "MVP",
  patent_pending: "Патент подан",
  patented: "Запатентовано",
  market: "На рынке",
};

export const VISIBILITY_LABELS: Record<string, string> = {
  public: "Публично",
  investors_only: "Только инвесторам",
  private: "Только мне",
};

export const INVESTOR_KIND_LABELS: Record<string, string> = {
  angel: "Частный инвестор",
  fund: "Фонд",
  corporate: "Корпорация",
  government: "Госинститут",
};

export function formatMoney(v: number | null): string | null {
  if (v == null) return null;
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)} млрд ₽`;
  if (v >= 1_000_000) return `${Math.round(v / 1_000_000)} млн ₽`;
  if (v >= 1_000) return `${Math.round(v / 1_000)} тыс ₽`;
  return `${v} ₽`;
}

export function ticketRange(
  min: number | null,
  max: number | null,
): string | null {
  if (min == null && max == null) return null;
  const lo = formatMoney(min);
  const hi = formatMoney(max);
  if (lo && hi) return `${lo} — ${hi}`;
  if (hi) return `до ${hi}`;
  return `от ${lo}`;
}
