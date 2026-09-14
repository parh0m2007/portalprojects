"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useList, useGetIdentity } from "@refinedev/core";
import type { Identity } from "@/lib/auth";
import { Guard } from "@/components/Guard";
import { EmptyState, Spinner, StatusBadge } from "@/components/ui";
import { InventionCardView } from "@/components/inventors/InventionCardView";
import { type InventionCard } from "@/components/inventors/shared";

function MyInventionsInner() {
  const { data: identity } = useGetIdentity<Identity | null>();
  const [tab, setTab] = useState<"published" | "draft">("published");

  const query = useList<InventionCard>({
    resource: "invention_cards",
    filters: [{ field: "author_id", operator: "eq", value: identity?.id ?? "" }],
    sorters: [{ field: "created_at", order: "desc" }],
    pagination: { pageSize: 100 },
    queryOptions: { enabled: !!identity?.id },
  });

  const byTab = useMemo(() => {
    const all = query.result.data ?? [];
    return {
      published: all.filter((i) => i.status === "published"),
      draft: all.filter((i) => i.status === "draft"),
    };
  }, [query.result.data]);

  const items = byTab[tab];

  return (
    <div className="container-page py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="h1">Мои изобретения</h1>
          <p className="muted mt-1">
            Управляйте видимостью: публичное раскрытие до подачи патентной
            заявки уничтожает новизну — держите работы закрытыми.
          </p>
        </div>
        <Link href="/my/inventions/new" className="btn btn-primary">
          Добавить изобретение
        </Link>
      </div>

      <div className="mt-6 flex gap-2">
        {(
          [
            ["published", `Опубликованные (${byTab.published.length})`],
            ["draft", `Черновики (${byTab.draft.length})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`cursor-pointer select-none border px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.1em] transition-colors ${
              tab === key
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
      ) : items.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title={tab === "draft" ? "Черновиков нет" : "Опубликованных изобретений нет"}
            description="Добавьте разработку, выберите видимость и опубликуйте — её увидят инвесторы и наставники."
            actionHref="/my/inventions/new"
            actionLabel="Добавить изобретение"
          />
        </div>
      ) : (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((inv) => (
            <div key={inv.id} className="space-y-2">
              <InventionCardView inv={inv} />
              <div className="flex items-center justify-between px-1">
                <Link href={`/my/inventions/${inv.id}`} className="text-xs font-semibold text-navy hover:underline">
                  Редактировать
                </Link>
                <StatusBadge status={inv.status === "published" ? "graded" : "submitted"} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MyInventionsPage() {
  return (
    <Guard>
      <MyInventionsInner />
    </Guard>
  );
}
