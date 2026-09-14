"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useList, useGetIdentity } from "@refinedev/core";
import { supabaseClient } from "@/lib/supabase";
import type { Identity } from "@/lib/auth";
import { EmptyState, Spinner } from "@/components/ui";
import { InventionCardView } from "@/components/inventors/InventionCardView";
import { STAGE_LABELS, type InventionCard } from "@/components/inventors/shared";

export default function InventionsPage() {
  const { data: identity } = useGetIdentity<Identity | null>();
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState<string>("all");

  const query = useList<InventionCard>({
    resource: "invention_cards",
    sorters: [{ field: "created_at", order: "desc" }],
    pagination: { pageSize: 200 },
  });

  const inventions = useMemo(() => {
    const all = query.result.data ?? [];
    return all
      .filter((i) => i.status === "published")
      .filter((i) => stage === "all" || i.stage === stage)
      .filter((i) => {
        const q = search.trim().toLowerCase();
        if (!q) return true;
        return (
          i.title.toLowerCase().includes(q) ||
          i.summary.toLowerCase().includes(q) ||
          i.author_name.toLowerCase().includes(q) ||
          i.sectors.some((s: string) => s.toLowerCase().includes(q))
        );
      });
  }, [query.result.data, search, stage]);

  return (
    <div className="container-page py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="h1">Витрина изобретений</h1>
          <p className="muted mt-1">
            Разработки участников Союза — от идеи до запатентованного продукта.
            Часть работ видна только одобренным инвесторам.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <input
            className="input w-full sm:w-72"
            placeholder="Поиск по названию, автору, сфере"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {identity && (
            <Link href="/my/inventions" className="btn btn-primary">
              Мои изобретения
            </Link>
          )}
        </div>
      </div>

      <div className="scrollbar-none mt-6 flex gap-2 overflow-x-auto pb-1">
        {[["all", "Все стадии"], ...Object.entries(STAGE_LABELS)].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setStage(key)}
            className={`shrink-0 cursor-pointer select-none border px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.1em] transition-colors ${
              stage === key
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
      ) : inventions.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title={search || stage !== "all" ? "Ничего не найдено" : "Витрина пока пуста"}
            description={
              search || stage !== "all"
                ? "Попробуйте изменить запрос или фильтр."
                : "Опубликуйте первое изобретение — его увидят инвесторы и наставники Союза."
            }
            actionHref={identity ? "/my/inventions" : undefined}
            actionLabel={identity ? "Добавить изобретение" : undefined}
          />
        </div>
      ) : (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {inventions.map((inv) => (
            <InventionCardView key={inv.id} inv={inv} />
          ))}
        </div>
      )}
    </div>
  );
}
