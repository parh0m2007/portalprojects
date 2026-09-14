"use client";

import { useMemo, useState } from "react";
import { useList, useGetIdentity } from "@refinedev/core";
import type { Identity } from "@/lib/auth";
import { EmptyState, Spinner } from "@/components/ui";
import {
  INVESTOR_KIND_LABELS,
  ticketRange,
  type InvestorProfile,
} from "@/components/inventors/shared";

export default function InvestorsPage() {
  const { data: identity } = useGetIdentity<Identity | null>();
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");

  const query = useList<InvestorProfile>({
    resource: "investor_profiles",
    sorters: [{ field: "created_at", order: "desc" }],
    pagination: { pageSize: 200 },
  });

  const investors = useMemo(() => {
    const mine = query.result.data ?? [];
    // Каталог показывает одобренных; свой профиль — даже на модерации
    return mine
      .filter((i) => i.status === "approved" || i.user_id === identity?.id)
      .filter((i) => kind === "all" || i.kind === kind)
      .filter((i) => {
        const q = search.trim().toLowerCase();
        if (!q) return true;
        return (
          i.name.toLowerCase().includes(q) ||
          i.thesis.toLowerCase().includes(q) ||
          i.sectors.some((s) => s.toLowerCase().includes(q))
        );
      });
  }, [query.result.data, search, kind, identity?.id]);

  const myProfile = (query.result.data ?? []).find(
    (i) => i.user_id === identity?.id,
  );

  return (
    <div className="container-page py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="h1">Инвесторы Союза</h1>
          <p className="muted mt-1">
            Частные инвесторы, фонды и корпорации, работающие с изобретателями.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <input
            className="input w-full sm:w-72"
            placeholder="Поиск по имени, тезису, сфере"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {identity && !myProfile && (
            <a href="/my/investor" className="btn btn-primary">
              Стать инвестором
            </a>
          )}
        </div>
      </div>

      <div className="scrollbar-none mt-6 flex gap-2 overflow-x-auto pb-1">
        {[["all", "Все"], ...Object.entries(INVESTOR_KIND_LABELS)].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setKind(key)}
            className={`shrink-0 cursor-pointer select-none border px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.1em] transition-colors ${
              kind === key
                ? "border-ink bg-ink text-white"
                : "border-line bg-transparent text-muted-ink hover:border-ink hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {query.query.isLoading ? (
        <Spinner />
      ) : investors.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title={search ? "Ничего не найдено" : "Каталог пока пуст"}
            description={
              search
                ? "Попробуйте изменить запрос."
                : "Инвесторы появятся после модерации профилей Союзом."
            }
          />
        </div>
      ) : (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {investors.map((inv) => {
            const range = ticketRange(inv.ticket_min, inv.ticket_max);
            const mine = inv.user_id === identity?.id;
            return (
              <div
                key={inv.user_id}
                className="card flex flex-col gap-3 p-5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-display text-lg font-bold tracking-tight">
                      {inv.name || "Инвестор"}
                    </p>
                    <p className="meta mt-0.5">
                      {INVESTOR_KIND_LABELS[inv.kind] ?? inv.kind}
                    </p>
                  </div>
                  {mine && inv.status !== "approved" && (
                    <span className="badge">На модерации</span>
                  )}
                </div>
                {inv.thesis && <p className="muted line-clamp-4 text-sm">{inv.thesis}</p>}
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
                <div className="mt-auto flex items-center justify-between border-t border-line pt-3">
                  <span className="meta">
                    {range ? (
                      <>
                        Чек: <span className="font-semibold text-ink">{range}</span>
                      </>
                    ) : null}
                  </span>
                  {inv.website && (
                    <a
                      href={inv.website}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-semibold text-navy hover:underline"
                    >
                      Сайт →
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
