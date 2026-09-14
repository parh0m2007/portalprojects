"use client";

import Link from "next/link";
import type { InventionCard } from "./shared";
import { STAGE_LABELS, VISIBILITY_LABELS, formatMoney } from "./shared";

export function InventionCardView({ inv }: { inv: InventionCard }) {
  return (
    <Link
      href={`/inventions/${inv.id}`}
      className="card flex flex-col gap-3 p-5 transition hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="badge badge-gold">{STAGE_LABELS[inv.stage] ?? inv.stage}</span>
        <span className="meta">
          {new Date(inv.created_at).toLocaleDateString("ru-RU", {
            day: "numeric",
            month: "short",
            year: "2-digit",
          })}
        </span>
      </div>
      <div>
        <p className="font-display text-lg font-bold leading-snug tracking-tight">
          {inv.title}
        </p>
        {inv.summary && (
          <p className="muted mt-1 line-clamp-2 text-sm">{inv.summary}</p>
        )}
      </div>
      {inv.sectors.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {inv.sectors.slice(0, 4).map((s) => (
            <span
              key={s}
              className="border border-line px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-muted-ink"
            >
              {s}
            </span>
          ))}
        </div>
      )}
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-3">
        <span className="text-xs font-semibold">{inv.author_name}</span>
        <span className="flex items-center gap-3">
          {inv.funding_goal != null && (
            <span className="meta">
              Цель: <span className="font-semibold text-ink">{formatMoney(inv.funding_goal)}</span>
            </span>
          )}
          {inv.visibility === "investors_only" && (
            <span className="meta">🔒 {VISIBILITY_LABELS[inv.visibility]}</span>
          )}
        </span>
      </div>
    </Link>
  );
}
