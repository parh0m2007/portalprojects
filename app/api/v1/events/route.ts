import { withApiKey } from "@/lib/api-route";
import { getServiceClient } from "@/lib/api-auth";

export const runtime = "nodejs";

/**
 * GET /api/v1/events            — каталог (публичный)
 * GET /api/v1/events?scope=mine — только события контекста ключа
 */
export const GET = withApiKey(
  async (ctx, _req, params) => {
    const db = getServiceClient();
    const scope = params.get("scope");
    const limit = Math.min(Number(params.get("limit") ?? 50), 200);

    let query = db
      .from("events")
      .select(
        "id, title, description, format, place, starts_at, registration_deadline, status, capacity, blind_judging, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (scope === "mine") {
      // события организации ключа или личные события владельца ключа
      const ids: string[] = [];
      if (ctx.org_id) {
        const { data } = await db
          .from("events")
          .select("id")
          .eq("organization_id", ctx.org_id);
        ids.push(...(data ?? []).map((e) => e.id));
      }
      if (ctx.user_id) {
        const { data } = await db
          .from("events")
          .select("id")
          .eq("author_id", ctx.user_id);
        ids.push(...(data ?? []).map((e) => e.id));
      }
      if (ids.length === 0) return [];
      query = query.in("id", ids);
    } else {
      query = query.eq("status", "published");
    }

    const { data, error } = await query;
    if (error) throw error;
    return data;
  },
  { allowAnonymous: true },
);

