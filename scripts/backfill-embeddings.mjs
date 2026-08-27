// ============================================================
// Простановка эмбеддингов для всех опубликованных событий.
//
// Использование:
//   npm run embed:backfill            — только события без вектора
//   node scripts/backfill-embeddings.mjs --force  — пересчитать все
//
// Требует: ollama serve + ollama pull bge-m3
//          (или EMBED_API_KEY/EMBED_API_URL/EMBED_MODEL в .env.local)
// Вход под демо-организатором anna@demo.ru (все сид-события её),
// поэтому RLS пропускает обновление events.embedding.
// ============================================================

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const FORCE = process.argv.includes("--force");
const TIMEOUT_MS = 60000;
const DELAY_MS = 200;

function loadEnvFile(path) {
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq <= 0) continue;
      const key = t.slice(0, eq).trim();
      const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {}
}

loadEnvFile(new URL("../.env.local", import.meta.url));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const email = process.env.SEED_EMAIL ?? "anna@demo.ru";
const password = process.env.SEED_PASSWORD ?? "demo1234";

if (!url || !key) {
  console.error("Нет NEXT_PUBLIC_SUPABASE_URL / PUBLISHABLE_KEY в .env.local");
  process.exit(1);
}

async function embedOpenAiCompatible(text) {
  const base = (
    process.env.EMBED_API_URL ?? "https://api.openai.com/v1"
  ).replace(/\/$/, "");
  const model = process.env.EMBED_MODEL ?? "text-embedding-3-small";
  const dim = Number(process.env.EMBED_DIM ?? 1024);
  const res = await fetch(`${base}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.EMBED_API_KEY}`,
    },
    body: JSON.stringify({ model, input: text.slice(0, 8000), dimensions: dim }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 150)}`);
  const json = await res.json();
  const emb = json.data?.[0]?.embedding;
  if (!Array.isArray(emb) || emb.length === 0) throw new Error("пустой эмбеддинг");
  return emb;
}

async function embedOllama(text) {
  const base = (process.env.OLLAMA_URL ?? "http://localhost:11434").replace(
    /\/$/,
    "",
  );
  const model = process.env.OLLAMA_MODEL ?? "bge-m3";
  let lastErr = "";
  for (const attempt of [
    async () => {
      const res = await fetch(`${base}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, input: text.slice(0, 4000) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) { lastErr = `/api/embed ${res.status}`; return null; }
      const json = await res.json();
      return json.embeddings?.[0] ?? null;
    },
    async () => {
      const res = await fetch(`${base}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: text.slice(0, 4000) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) { lastErr = `/api/embeddings ${res.status}`; return null; }
      const json = await res.json();
      return Array.isArray(json.embedding) && json.embedding.length > 0
        ? json.embedding
        : null;
    },
  ]) {
    try {
      const emb = await attempt();
      if (emb) return emb;
    } catch (e) {
      lastErr = e?.message ?? String(e);
    }
  }
  throw new Error(
    `${lastErr}. Проверьте: ollama serve и ollama pull ${model}`,
  );
}

const embed = process.env.EMBED_API_KEY ? embedOpenAiCompatible : embedOllama;

const supabase = createClient(url, key, { auth: { persistSession: false } });

const { error: authError } = await supabase.auth.signInWithPassword({
  email,
  password,
});
if (authError) {
  console.error(`Не удалось войти как ${email}: ${authError.message}`);
  process.exit(1);
}
console.log(`Вход: ${email}`);

const { data: events, error: listError } = await supabase
  .from("events")
  .select("id, title, description, embedding")
  .eq("status", "published")
  .order("created_at", { ascending: true });
if (listError) {
  console.error(`Не удалось получить список событий: ${listError.message}`);
  process.exit(1);
}

const todo = FORCE ? events : events.filter((e) => !e.embedding);
console.log(
  `Событий: ${events.length}, к обработке: ${todo.length}${FORCE ? " (--force)" : ""}`,
);

let ok = 0;
let failed = 0;
for (const [i, ev] of todo.entries()) {
  const text = `${ev.title}. ${ev.description}`;
  try {
    const vector = await embed(text);
    const { error } = await supabase
      .from("events")
      .update({ embedding: "[" + vector.map((v) => v.toString()).join(",") + "]" })
      .eq("id", ev.id);
    if (error) throw new Error(error.message);
    ok++;
    console.log(`[${i + 1}/${todo.length}] ✓ ${ev.title} (${vector.length}d)`);
  } catch (e) {
    failed++;
    console.error(`[${i + 1}/${todo.length}] ✗ ${ev.title}: ${e?.message ?? e}`);
  }
  await new Promise((r) => setTimeout(r, DELAY_MS));
}

console.log(`\nГотово. Успешно: ${ok}, с ошибками: ${failed}.`);
if (ok > 0) console.log("Обновите главную — векторная часть скоринга активна.");
