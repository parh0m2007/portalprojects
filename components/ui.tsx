"use client";

import Link from "next/link";
import { Inbox } from "lucide-react";

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center py-16 ${className}`}>
      <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-line border-t-ink" />
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function EmptyState({
  title,
  description,
  actionHref,
  actionLabel,
}: {
  title: string;
  description?: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-14 text-center">
      <span className="flex h-12 w-12 items-center justify-center border border-line text-muted-ink">
        <Inbox size={20} strokeWidth={1.5} />
      </span>
      <p className="text-base font-bold">{title}</p>
      {description && <p className="muted max-w-sm">{description}</p>}
      {actionHref && actionLabel && (
        <Link href={actionHref} className="btn btn-primary mt-3">
          {actionLabel}
        </Link>
      )}
    </div>
  );
}

export function StatCard({
  value,
  label,
  tone = "light",
}: {
  value: React.ReactNode;
  label: string;
  tone?: "light" | "navy";
}) {
  return (
    <div
      className={
        tone === "navy"
          ? "border-t-2 border-gold pt-4"
          : "border-t-2 border-ink pt-4"
      }
    >
      <p className="font-display text-[1.75rem] font-bold leading-none tracking-tight tabular-nums">
        {value}
      </p>
      <p className="meta mt-2">{label}</p>
    </div>
  );
}

export function FormatBadge({ format }: { format: string }) {
  return format === "lecture" ? (
    <span className="badge">Лекция</span>
  ) : (
    <span className="badge badge-gold">Кейс-чемпионат</span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    pending: { cls: "badge-gold", label: "На рассмотрении" },
    approved: { cls: "badge-green", label: "Одобрена" },
    rejected: { cls: "badge-red", label: "Отклонена" },
    waitlist: { cls: "badge-navy", label: "Лист ожидания" },
    accepted: { cls: "badge-green", label: "Принято" },
    declined: { cls: "badge-gray", label: "Отклонено" },
    submitted: { cls: "badge-navy", label: "На проверке" },
    graded: { cls: "badge-green", label: "Оценено" },
  };
  const item = map[status] ?? { cls: "badge-gray", label: status };
  return <span className={`badge ${item.cls}`}>{item.label}</span>;
}

export function Field({
  label,
  children,
  hint,
  required,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="label">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

// ---------- Детерминированные обложки-паттерны ----------
// Вместо градиентов: геометрия из seed события в дуплексе navy × gold.
function hashCode(s: string): number {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const PAPER_BG = "#f1f1ec";
const INK_STROKE = "#16305f";

export function CoverPlaceholder({
  seed,
  className = "",
}: {
  seed?: string;
  className?: string;
}) {
  const h = seed ? hashCode(seed) : 12345;
  const variant = h % 5;

  let art: React.ReactNode = null;
  if (variant === 0) {
    // Диагональная штриховка
    art = (
      <g stroke={INK_STROKE} strokeOpacity={0.28} strokeWidth={1.5}>
        {Array.from({ length: 16 }, (_, i) => (
          <line
            key={i}
            x1={i * 36 - 260}
            y1={220}
            x2={i * 36 + 40}
            y2={-40}
          />
        ))}
      </g>
    );
  } else if (variant === 1) {
    // Концентрические окружности из точки на нижней кромке
    const cx = 60 + ((h >> 4) % 280);
    art = (
      <g fill="none" stroke={INK_STROKE} strokeOpacity={0.32}>
        {Array.from({ length: 6 }, (_, i) => (
          <circle key={i} cx={cx} cy={190} r={22 + i * 30} />
        ))}
      </g>
    );
  } else if (variant === 2) {
    // Точечная сетка
    art = (
      <g fill={INK_STROKE} fillOpacity={0.32}>
        {Array.from({ length: 10 }, (_, row) =>
          Array.from({ length: 17 }, (_, col) => (
            <circle
              key={`${row}-${col}`}
              cx={14 + col * 24}
              cy={12 + row * 19}
              r={(h >> (row % 6)) % 3 === 0 ? 2.4 : 1.3}
            />
          )),
        )}
      </g>
    );
  } else if (variant === 3) {
    // Вертикальные полосы переменной ширины
    art = (
      <g fill={INK_STROKE} fillOpacity={0.22}>
        {Array.from({ length: 13 }, (_, i) => {
          const bh = 46 + ((h >> (i % 9)) % 100);
          return (
            <rect key={i} x={8 + i * 31} y={180 - bh} width={11} height={bh} />
          );
        })}
      </g>
    );
  } else {
    // Сетка крестиков
    art = (
      <g stroke={INK_STROKE} strokeOpacity={0.38} strokeWidth={1.4}>
        {Array.from({ length: 4 }, (_, row) =>
          Array.from({ length: 9 }, (_, col) => {
            const cx = 26 + col * 44;
            const cy = 26 + row * 42;
            return (
              <g key={`${row}-${col}`}>
                <line x1={cx - 6} y1={cy} x2={cx + 6} y2={cy} />
                <line x1={cx} y1={cy - 6} x2={cx} y2={cy + 6} />
              </g>
            );
          }),
        )}
      </g>
    );
  }

  // Один золотой элемент — позиция тоже из seed
  const gx = 40 + ((h >> 6) % 320);
  const gy = 30 + ((h >> 9) % 120);

  return (
    <svg
      viewBox="0 0 400 180"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      className={`block w-full ${className}`}
    >
      <rect width="400" height="180" fill={PAPER_BG} />
      {art}
      <circle cx={gx} cy={gy} r={9} fill="var(--color-gold)" />
    </svg>
  );
}

export function formatDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatShortDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function isRegistrationClosed(event: {
  status: string;
  registration_deadline: string | null;
}): boolean {
  if (event.status !== "published") return true;
  if (!event.registration_deadline) return false;
  return new Date(event.registration_deadline).getTime() < Date.now();
}
