"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useOne, useList, useGetIdentity, useNotification } from "@refinedev/core";
import { supabaseClient } from "@/lib/supabase";
import type { Identity } from "@/lib/auth";
import type { EventRecord } from "@/components/EventCard";
import { EventCard } from "@/components/EventCard";
import { EmptyState, Spinner } from "@/components/ui";

type Organizer = { id: string; full_name: string; bio: string };
type OrganizerStats = { organizer_id: string; followers_count: number; events_count: number };
type FollowRow = { follower_id: string; organizer_id: string };

function OrganizerProfile() {
  const { id } = useParams<{ id: string }>();
  const { data: identity } = useGetIdentity<Identity | null>();
  const { open } = useNotification();

  const orgQuery = useOne<Organizer>({
    resource: "organizers",
    id,
  });
  const statsQuery = useList<OrganizerStats>({
    resource: "organizer_stats",
    filters: [
      { field: "organizer_id", operator: "eq", value: id as string },
    ],
    pagination: { pageSize: 1 },
  });
  const myFollowQuery = useList<FollowRow>({
    resource: "follows",
    filters: [
      { field: "follower_id", operator: "eq", value: identity?.id ?? "" },
      { field: "organizer_id", operator: "eq", value: id as string },
    ],
    pagination: { pageSize: 1 },
    queryOptions: { enabled: !!identity?.id },
  });
  const eventsQuery = useList<EventRecord>({
    resource: "events",
    filters: [
      { field: "author_id", operator: "eq", value: id as string },
      { field: "status", operator: "eq", value: "published" },
    ],
    sorters: [{ field: "starts_at", order: "asc" }],
    pagination: { pageSize: 60 },
  });

  const org = orgQuery.result;
  const stats = statsQuery.result.data?.[0];
  const following = (myFollowQuery.result.data ?? []).length > 0;
  const events = eventsQuery.result.data ?? [];
  const initials = (org?.full_name ?? "?")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  function toggleFollow() {
    if (!identity || !org) return;
    if (following) {
      supabaseClient
        .from("follows")
        .delete()
        .eq("follower_id", identity.id)
        .eq("organizer_id", org.id)
        .then(() => {
          myFollowQuery.query.refetch().catch(() => {});
          statsQuery.query.refetch().catch(() => {});
        });
    } else {
      supabaseClient
        .from("follows")
        .insert({ follower_id: identity.id, organizer_id: org.id })
        .then(() => {
          myFollowQuery.query.refetch().catch(() => {});
          statsQuery.query.refetch().catch(() => {});
          open?.({
            type: "success",
            message: "Вы подписались",
            description: "Будем уведомлять о новых событиях организатора.",
          });
        });
    }
  }

  if (orgQuery.query.isLoading) return <Spinner />;
  if (!org)
    return (
      <div className="container-page py-12">
        <EmptyState
          title="Организатор не найден"
          actionHref="/"
          actionLabel="На главную"
        />
      </div>
    );

  return (
    <div className="container-page py-10">
      <div className="card flex flex-col gap-5 p-6 md:flex-row md:items-center md:p-8">
        <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-gold-500 text-2xl font-extrabold text-navy-950">
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="h1">{org.full_name || "Организатор"}</h1>
          {org.bio && <p className="mt-2 max-w-2xl text-[15px] text-slate-700">{org.bio}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="badge badge-navy">
              {stats?.events_count ?? events.length} событий
            </span>
            <span className="badge badge-gold">
              {stats?.followers_count ?? 0} подписчиков
            </span>
          </div>
        </div>
        {identity && identity.id !== org.id && (
          <button
            className={following ? "btn btn-ghost md:w-44" : "btn btn-primary md:w-44"}
            onClick={toggleFollow}
          >
            {following ? "✓ Вы подписаны" : "+ Подписаться"}
          </button>
        )}
      </div>

      <section className="mt-10">
        <h2 className="h2 mb-4">События организатора</h2>
        {eventsQuery.query.isLoading ? (
          <Spinner />
        ) : events.length === 0 ? (
          <div className="card p-6 muted">Опубликованных событий пока нет.</div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default function OrganizerPage() {
  return <OrganizerProfile />;
}
