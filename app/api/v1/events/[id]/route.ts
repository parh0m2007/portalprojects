import { withApiKey, eventVisibleTo } from "@/lib/api-route";
import { getServiceClient } from "@/lib/api-auth";

export const runtime = "nodejs";

/**
 * GET /api/v1/events/:id — событие с кейсами, критериями и статистикой.
 * Публичные — всем; черновики — только контексту ключа.
 */
export const GET = withApiKey(
  async (ctx, _req, params) => {
    const id = params.get("id") ?? "";
    const db = getServiceClient();

    const { data: event, error } = await db
      .from("events")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!event) {
      throw new Error("not_found: событие не найдено");
    }

    const isPrivate = event.status !== "published";
    if (isPrivate && !(await eventVisibleTo(ctx, id))) {
      throw new Error("forbidden: событие не опубликовано");
    }

    const [{ data: cases }, { data: criteria }, { data: stats }] = await Promise.all([
      db.from("cases").select("id, title, description").eq("event_id", id),
      db
        .from("criteria")
        .select("id, title, max_score, sort_order")
        .eq("event_id", id)
        .order("sort_order"),
      db.from("event_stats").select("*").eq("event_id", id).maybeSingle(),
    ]);

    return { event, cases: cases ?? [], criteria: criteria ?? [], stats };
  },
  { allowAnonymous: true },
);

