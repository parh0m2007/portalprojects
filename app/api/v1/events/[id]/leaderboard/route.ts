import { withApiKey, eventVisibleTo } from "@/lib/api-route";
import { getServiceClient } from "@/lib/api-auth";

export const runtime = "nodejs";

/**
 * GET /api/v1/events/:id/leaderboard?mode=raw|normalized
 *  raw         — сумма баллов (классика)
 *  normalized  — z-score с компенсацией строгости судей (0..100)
 * Итоги публикуются через RPC publish_results (только организатор).
 */
export const GET = withApiKey(
  async (ctx, _req, params) => {
    const eventId = params.get("id") ?? "";
    const mode = params.get("mode") ?? "raw";
    const db = getServiceClient();

    // лидерборд публичен после публикации итогов, иначе — только контексту ключа
    const { data: event } = await db
      .from("events")
      .select("results_published_at, status")
      .eq("id", eventId)
      .maybeSingle();
    if (!event) throw new Error("not_found: событие не найдено");

    const published = !!event.results_published_at;
    if (!published && !(await eventVisibleTo(ctx, eventId))) {
      throw new Error("forbidden: итоги ещё не опубликованы");
    }

    if (mode === "normalized") {
      const { data, error } = await db.rpc("normalized_leaderboard", {
        ev: eventId,
      });
      if (error) throw error;
      return { mode, rows: data ?? [] };
    }

    const { data, error } = await db
      .from("leaderboard")
      .select("*")
      .eq("event_id", eventId);
    if (error) throw error;
    const rows = [...(data ?? [])].sort(
      (a, b) => (b.total_score ?? 0) - (a.total_score ?? 0),
    );
    return { mode, rows };
  },
  { allowAnonymous: true },
);

