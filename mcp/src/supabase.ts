import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export class AuthError extends Error {}

/**
 * Клиент Supabase с сессией организатора.
 * MCP_ ORG_EMAIL/ORG_PASSWORD — демо-аккаунт с правами на все сид-события.
 * Перед продажей заменяется на интеграционный токен организации.
 */
export function createSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const email = process.env.MCP_ORG_EMAIL;
  const password = process.env.MCP_ORG_PASSWORD;

  if (!url || !key) {
    throw new AuthError(
      "Задайте NEXT_PUBLIC_SUPABASE_URL и ключ Supabase (переменные окружения)",
    );
  }
  if (!email || !password) {
    throw new AuthError("Задайте MCP_ORG_EMAIL и MCP_ORG_PASSWORD");
  }

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Аутентификация выполняется один раз при старте (см. index.ts)
  return client;
}

export async function signInOrganizer(
  client: SupabaseClient,
): Promise<void> {
  const email = process.env.MCP_ORG_EMAIL!;
  const password = process.env.MCP_ORG_PASSWORD!;
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new AuthError(
      `Не удалось войти как организатор (${email}): ${error.message}`,
    );
  }
}
