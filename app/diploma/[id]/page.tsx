"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useOne, useList } from "@refinedev/core";
import { EmptyState, Spinner, formatDate } from "@/components/ui";
import { Guard } from "@/components/Guard";

type Registration = { id: string; event_id: string; team_id: string | null; status: string };
type LeaderboardRow = {
  registration_id: string;
  team_name: string | null;
  participant_name: string | null;
  total_score: number;
};
type Organizer = { id: string; full_name: string };

const MEDALS = ["🥇", "🥈", "🥉"];
const DEGREES = ["I степени", "II степени", "III степени"];

function Diploma() {
  const { id } = useParams<{ id: string }>();

  const { result: reg, query } = useOne<Registration>({
    resource: "registrations",
    id,
  });
  const eventQuery = useOneSafeEvent(reg?.event_id);
  const event = eventQuery.data;
  const boardQuery = useList<LeaderboardRow>({
    resource: "leaderboard",
    filters: [
      { field: "registration_id", operator: "eq", value: id as string },
    ],
    pagination: { pageSize: 1 },
    queryOptions: { enabled: !!id },
  });
  const board = boardQuery.result.data?.[0];
  const eventBoardQuery = useList<LeaderboardRow>({
    resource: "leaderboard",
    filters: [
      { field: "event_id", operator: "eq", value: reg?.event_id ?? "" },
    ],
    sorters: [{ field: "total_score", order: "desc" }],
    pagination: { pageSize: 200 },
    queryOptions: { enabled: !!reg?.event_id },
  });
  const organizerQuery = useList<Organizer>({
    resource: "organizers",
    filters: [
      { field: "id", operator: "eq", value: event?.author_id ?? "" },
    ],
    pagination: { pageSize: 1 },
    queryOptions: { enabled: !!event?.author_id },
  });

  if (query.isLoading || (reg && eventQuery.isLoading)) return <Spinner />;
  if (!reg || !event || !event.results_published_at || reg.status !== "approved")
    return (
      <div className="container-page py-12">
        <EmptyState
          title="Диплом недоступен"
          description="Диплом выдаётся после публикации итогов мероприятия и подтверждения участия."
          actionHref="/my/registrations"
          actionLabel="К моим регистрациям"
        />
      </div>
    );

  const place =
    (eventBoardQuery.result.data ?? []).findIndex(
      (row) => row.registration_id === reg?.id,
    ) + 1;
  const name = board?.team_name || board?.participant_name || "Участник";
  const isWinner = place > 0 && place <= 3 && (board?.total_score ?? 0) > 0;

  return (
    <div className="container-page py-10">
      <div className="mx-auto mb-6 flex max-w-3xl items-center justify-between print:hidden">
        <Link href="/my/registrations" className="btn btn-ghost">
          ← Назад
        </Link>
        <button className="btn btn-accent" onClick={() => window.print()}>
          🖨 Печать / Сохранить PDF
        </button>
      </div>

      <div className="diploma mx-auto max-w-3xl rounded-2xl border-8 border-navy-800 bg-white p-10 text-center shadow-xl md:p-16">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-muted">
          КейсПортал
        </p>
        <h1 className="mt-4 text-3xl font-extrabold text-navy-800 md:text-4xl">
          {isWinner ? `Диплом ${DEGREES[place - 1]}` : "Диплом участника"}
        </h1>
        {isWinner && <p className="mt-2 text-4xl">{MEDALS[place - 1]}</p>}
        <p className="muted mt-6">награждается</p>
        <p className="mt-2 text-2xl font-bold text-ink md:text-3xl">{name}</p>
        <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-slate-700">
          за участие в мероприятии
        </p>
        <p className="mt-1 text-lg font-semibold text-navy-800">«{event.title}»</p>
        {board && board.total_score > 0 && (
          <p className="mt-3 text-sm text-muted">
            Итоговый балл жюри: <b className="text-ink">{board.total_score}</b>
          </p>
        )}
        <div className="mt-10 flex items-end justify-between text-left text-sm">
          <div>
            <p className="muted">Дата события</p>
            <p className="font-semibold">{formatDate(event.starts_at)}</p>
          </div>
          <div className="text-right">
            <p className="muted">Организатор</p>
            <p className="font-semibold">
              {organizerQuery.result.data?.[0]?.full_name || "КейсПортал"}
            </p>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 0; }
          body { background: #fff !important; }
          body > * { visibility: hidden; }
          .diploma, .diploma * { visibility: visible; }
          .diploma {
            position: fixed; inset: 0; margin: auto;
            max-width: none; width: 90%; height: fit-content;
            border-radius: 0; box-shadow: none;
          }
        }
      `}</style>
    </div>
  );
}

function useOneSafeEvent(eventId?: string) {
  const query = useOne<{ id: string; title: string; starts_at: string | null; author_id: string; results_published_at: string | null }>({
    resource: "events",
    id: eventId ?? "",
    queryOptions: { enabled: !!eventId },
  });
  return { data: query.result, isLoading: query.query.isLoading };
}

export default function DiplomaPage() {
  return (
    <Guard>
      <Diploma />
    </Guard>
  );
}
