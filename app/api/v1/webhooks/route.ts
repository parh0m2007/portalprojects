import { withApiKey, eventVisibleTo } from "@/lib/api-route";
import { getServiceClient } from "@/lib/api-auth";

export const runtime = "nodejs";

/**
 * GET  /api/v1/webhooks           — список webhook-подписок организации
 * POST /api/v1/webhooks          — создать подписку { url, events? }
 * DELETE /api/v1/webhooks?id=...  — удалить подписку
 *
 * События: registration.created, registration.status_changed,
 *          solution.uploaded, results.published
 * Подпись: X-CasePortal-Signature: sha256=<hmac(payload, secret)>
 */
export const GET = withApiKey(async (ctx) => {
  if (!ctx.org_id) throw new Error("forbidden: webhooks доступны ключам организаций");
  const db = getServiceClient();
  const { data, error } = await db
    .from("api_webhooks")
    .select("id, url, events, is_active, created_at")
    .eq("org_id", ctx.org_id);
  if (error) throw error;
  return data ?? [];
});

export const POST = withApiKey(async (ctx, req) => {
  if (!ctx.org_id) throw new Error("forbidden: webhooks доступны ключам организаций");

  let body: { url?: string; events?: string[] };
  try {
    body = await req.json();
  } catch {
    throw new Error("bad_request: некорректный JSON");
  }
  const url = (body.url ?? "").trim();
  if (!/^https?:\/\//.test(url)) {
    throw new Error("bad_request: url должен быть http(s)");
  }

  const allowed = [
    "registration.created",
    "registration.status_changed",
    "solution.uploaded",
    "results.published",
    "contact_request.created",
  ];
  const events = (body.events ?? ["registration.created"]).filter((e) =>
    allowed.includes(e),
  );
  if (events.length === 0) {
    throw new Error(`bad_request: допустимые события: ${allowed.join(", ")}`);
  }

  const db = getServiceClient();
  const { data, error } = await db
    .from("api_webhooks")
    .insert({ org_id: ctx.org_id, url, events })
    .select("id, url, events, is_active, created_at")
    .single();
  if (error) throw error;
  return data;
});

export const DELETE = withApiKey(async (ctx, _req, params) => {
  if (!ctx.org_id) throw new Error("forbidden: webhooks доступны ключам организаций");
  const id = params.get("id") ?? "";
  const db = getServiceClient();
  const { error } = await db
    .from("api_webhooks")
    .delete()
    .eq("id", id)
    .eq("org_id", ctx.org_id);
  if (error) throw error;
  return { deleted: true };
});

