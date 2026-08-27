"use client";

export type Tag = {
  id: string;
  name: string;
  emoji: string;
};

export function TagChips({
  tags,
  selected,
  onToggle,
  variant = "editor",
}: {
  tags: Tag[];
  selected: Set<string>;
  onToggle: (tagId: string) => void;
  /** editor — блок-выбор; filter — горизонтальная лента над лентой */
  variant?: "editor" | "filter";
}) {
  const chip = (active: boolean) =>
    `cursor-pointer select-none border px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.1em] transition-colors ${
      active
        ? "border-ink bg-ink text-white"
        : "border-line bg-transparent text-muted-ink hover:border-ink hover:text-ink"
    }`;

  if (variant === "filter") {
    return (
      <div className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {tags.map((t) => {
          const active = selected.has(t.id);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onToggle(t.id)}
              className={`shrink-0 ${chip(active)}`}
            >
              {t.name}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((t) => {
        const active = selected.has(t.id);
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onToggle(t.id)}
            className={chip(active)}
          >
            {t.name}
          </button>
        );
      })}
    </div>
  );
}
