import { NextResponse } from "next/server";
import { getServiceClient, verifyApiKey, type ApiKeyContext } from "@/lib/api-auth";

export const runtime = "nodejs";

type Handler = (ctx: ApiKeyContext, req: Request, params: URLSearchParams) => Promise<unknown>;

export function jsonError(status: number, error: string, details?: string) {
  return NextResponse.json({ error, details }, { status });
}

/**
 * Обёртка REST-роута: проверяет API-ключ и отдаёт единый формат ошибок.
 * GET-роуты публичного каталога (/events, /leaderboard) допускают и
 * анонимный доступ (без ключа) — для этого передайте allowAnonymous: true.
 */
export function withApiKey(
  handler: Handler,
  { allowAnonymous = false }: { allowAnonymous?: boolean } = {},
) {
  return async (req: Request) => {
    let ctx: ApiKeyContext | null = null;
    try {
      ctx = await verifyApiKey(req);
    } catch {
      return jsonError(503, "api_unavailable", "REST API не настроен: задайте SUPABASE_SECRET_KEY");
    }
    if (!ctx) {
      if (!allowAnonymous) return jsonError(401, "invalid_api_key");
      ctx = { api_key_id: "", org_id: null, user_id: null };
    }
    try {
      const data = await handler(ctx, req, new URL(req.url).searchParams);
      return NextResponse.json({ data });
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown_error";
      return jsonError(500, "internal_error", message);
    }
  };
}

/** Событие принадлежит контексту ключа (организация или личное). */
export async function eventVisibleTo(ctx: ApiKeyContext, eventId: string): Promise<boolean> {
  const db = getServiceClient();
  const { data } = await db
    .from("events")
    .select("id, organization_id, author_id")
    .eq("id", eventId)
    .maybeSingle();
  if (!data) return false;
  if (ctx.org_id) return data.organization_id === ctx.org_id;
  if (ctx.user_id) return data.author_id === ctx.user_id;
  return false;
}
