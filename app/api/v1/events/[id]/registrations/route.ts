import { withApiKey, eventVisibleTo } from "@/lib/api-route";
import { getServiceClient } from "@/lib/api-auth";

export const runtime = "nodejs";

/**
 * GET /api/v1/events/:id/registrations — заявки события.
 * Только для контекста ключа (организация/автор) — персональные данные.
 */
export const GET = withApiKey(async (ctx, _req, params) => {
  const eventId = params.get("id") ?? "";
  if (!(await eventVisibleTo(ctx, eventId))) {
    throw new Error("forbidden: событие не принадлежит контексту ключа");
  }

  const db = getServiceClient();
  const { data, error } = await db
    .from("registrations")
    .select(
      "id, status, contact, comment, created_at, teams(name), cases(title), solutions(id, title)",
    )
    .eq("event_id", eventId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;

  type RegRow = {
    id: string;
    status: string;
    contact: string;
    comment: string;
    created_at: string;
    teams: { name: string }[] | null;
    cases: { title: string }[] | null;
    solutions: { id: string; title: string }[] | null;
  };
  return ((data ?? []) as unknown as RegRow[]).map((r) => ({
    id: r.id,
    status: r.status,
    contact: r.contact,
    comment: r.comment,
    team: r.teams?.[0]?.name ?? null,
    case: r.cases?.[0]?.title ?? null,
    solutions: r.solutions ?? [],
    created_at: r.created_at,
  }));
});

