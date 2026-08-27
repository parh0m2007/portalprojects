import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !publishableKey) {
  throw new Error(
    "Нет переменных окружения Supabase: задайте NEXT_PUBLIC_SUPABASE_URL и NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY в .env.local",
  );
}

export const supabaseClient = createClient(url, publishableKey);

export const SOLUTIONS_BUCKET = "solutions";
export const COVERS_BUCKET = "covers";

export function publicFileUrl(bucket: string, path?: string | null): string | null {
  if (!path) return null;
  const { data } = supabaseClient.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

export function solutionFileUrl(path?: string | null): string | null {
  return publicFileUrl(SOLUTIONS_BUCKET, path);
}
