"use client";

import Link from "next/link";
import { useGetIdentity } from "@refinedev/core";
import { ArrowUpRight, Calendar, Compass, Heart, MapPin, Users, X } from "lucide-react";
import type { Identity } from "@/lib/auth";
import { COVERS_BUCKET, publicFileUrl, supabaseClient } from "@/lib/supabase";
import {
  CoverPlaceholder,
  FormatBadge,
  formatShortDate,
  isRegistrationClosed,
} from "./ui";
import type { Tag } from "./TagChips";

export type EventRecord = {
  id: string;
  title: string;
  description: string;
  format: "case" | "lecture";
  place: string;
  starts_at: string | null;
  registration_deadline: string | null;
  status: string;
  author_id: string;
  cover_path?: string | null;
  results_published_at?: string | null;
  capacity?: number | null;
  embedding?: string | null;
};

export function EventCard({
  event,
  participantsCount,
  tags = [],
  onHide,
  saved,
  onToggleSave,
  score,
  matchCount,
  explore,
  compact,
}: {
  event: EventRecord;
  participantsCount?: number;
  tags?: Tag[];
  onHide?: () => void;
  saved?: boolean;
  onToggleSave?: () => void;
  score?: number;
  matchCount?: number;
  explore?: boolean;
  /** компактный режим: без описания и тегов (для лекций в плотной сетке) */
  compact?: boolean;
}) {
  const { data: identity } = useGetIdentity<Identity | null>();
  const isAuthor = identity?.id === event.author_id;
  const closed = isRegistrationClosed(event);
  const coverUrl = publicFileUrl(COVERS_BUCKET, event.cover_path);

  function trackView() {
    if (!identity) return;
    supabaseClient
      .from("event_views")
      .insert({ user_id: identity.id, event_id: event.id })
      .then(() => {}, () => {});
  }

  return (
    <div className="card group relative flex flex-col overflow-hidden transition-colors hover:border-ink">
      {onToggleSave && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleSave();
          }}
          title={saved ? "Убрать из сохранённых" : "Сохранить — лента подстроится"}
          aria-label={saved ? "Убрать из сохранённых" : "Сохранить"}
          className="absolute right-2 top-2 z-10 flex h-9 w-9 items-center justify-center bg-white/95 text-muted-ink transition-colors hover:text-ink"
        >
          <Heart
            size={17}
            strokeWidth={1.8}
            fill={saved ? "var(--color-gold)" : "none"}
            stroke={saved ? "#c47f00" : "currentColor"}
          />
        </button>
      )}
      {onHide && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onHide();
          }}
          title="Скрыть из ленты"
          aria-label="Скрыть из ленты"
          className={`absolute z-10 flex h-8 w-8 items-center justify-center bg-white/95 text-muted-ink transition-colors hover:text-ink group-hover:opacity-100 ${
            onToggleSave ? "right-12 opacity-0" : "right-2 opacity-0"
          }`}
        >
          <X size={15} strokeWidth={1.8} />
        </button>
      )}
      <Link href={`/events/${event.id}`} onClick={trackView} className="flex min-h-0 flex-1 flex-col">
        <div className="relative overflow-hidden border-b border-line">
          <div className="transition-transform duration-300 ease-out group-hover:scale-[1.03]">
            {coverUrl ? (
              <img
                src={coverUrl}
                alt={event.title}
                loading="lazy"
                className={`w-full object-cover ${compact ? "h-28" : "h-40"}`}
              />
            ) : (
              <CoverPlaceholder
                seed={event.id}
                className={compact ? "h-28" : "h-40"}
              />
            )}
          </div>
          <div className="absolute left-3 top-3 flex flex-wrap gap-2">
            <FormatBadge format={event.format} />
            {closed && <span className="badge">Запись закрыта</span>}
          </div>
          {explore && (
            <span
              title="Слот разнообразия: событие вне текущего вкуса — вдруг зайдёт"
              className="badge badge-plain badge-gold absolute bottom-3 left-3 bg-white/95"
            >
              <Compass size={11} strokeWidth={2} />
              Не из вашей темы
            </span>
          )}
        </div>
        <div className="flex min-h-0 flex-1 flex-col p-5">
          <h3 className="text-[1.0625rem] font-bold leading-snug tracking-[-0.01em] underline-offset-4 decoration-gold decoration-2 group-hover:underline">
            {event.title}
          </h3>
          {!compact && (
            <>
              <p className="muted mt-1.5 line-clamp-2">{event.description}</p>
              {tags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
                  {tags.slice(0, 3).map((t) => (
                    <span key={t.id} className="meta normal-case tracking-normal">
                      #{t.name}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
          <div className="mt-auto pt-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-3.5">
              <span className="meta inline-flex items-center gap-1.5">
                <Calendar size={12} strokeWidth={1.8} />
                {formatShortDate(event.starts_at)}
              </span>
              {event.place && (
                <span className="meta inline-flex items-center gap-1.5">
                  <MapPin size={12} strokeWidth={1.8} />
                  {event.place}
                </span>
              )}
              {typeof participantsCount === "number" && (
                <span className="meta inline-flex items-center gap-1.5">
                  <Users size={12} strokeWidth={1.8} />
                  {participantsCount}
                </span>
              )}
              {typeof score === "number" && (
                <span
                  title="Персональный скоринг ленты"
                  className="meta ml-auto !normal-case text-navy"
                >
                  {score.toFixed(2)}
                  {typeof matchCount === "number" && matchCount > 0
                    ? ` / ${matchCount}`
                    : ""}
                </span>
              )}
            </div>
          </div>
        </div>
      </Link>
      <div className="flex items-stretch border-t border-line">
        {closed ? (
          <span className="btn btn-ghost flex-1 cursor-default opacity-60 border-0">
            Запись закрыта
          </span>
        ) : (
          <Link
            href={`/events/${event.id}`}
            onClick={trackView}
            className="btn btn-primary flex-1 rounded-none"
          >
            {event.format === "case" ? "Участвовать" : "Записаться"}
            <ArrowUpRight size={13} strokeWidth={2} />
          </Link>
        )}
        {isAuthor && (
          <Link
            href={`/my/events/${event.id}`}
            className="btn btn-ghost rounded-none border-0 border-l border-line"
          >
            Статистика
          </Link>
        )}
      </div>
    </div>
  );
}
