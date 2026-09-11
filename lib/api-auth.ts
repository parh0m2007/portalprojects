import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type ApiKeyContext = {
  api_key_id: string;
  org_id: string | null;
  user_id: string | null;
};

let serviceClient: SupabaseClient | null = null;

/**
 * Service-role клиент для проверки API-ключей.
 * Используется ТОЛЬКО на сервере: verify_api_key не выдан authenticated/anon.
 */
export function getServiceClient(): SupabaseClient {
  if (!serviceClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error("REST API требует SUPABASE_SECRET_KEY (service role) в окружении");
    }
    serviceClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return serviceClient;
}

/**
 * Проверяет ключ из заголовка Authorization: Bearer cp_...
 * Возвращает контекст ключа или null.
 */
export async function verifyApiKey(req: Request): Promise<ApiKeyContext | null> {
  const header =
    req.headers.get("authorization") ?? req.headers.get("x-api-key") ?? "";
  const raw = header.replace(/^Bearer\s+/i, "").trim();
  if (!raw.startsWith("cp_")) return null;

  const { data, error } = await getServiceClient().rpc("verify_api_key", {
    raw_key: raw,
  });
  if (error || !data || data.length === 0) return null;
  return {
    api_key_id: data[0].api_key_id,
    org_id: data[0].org_id,
    user_id: data[0].user_id,
  };
}
