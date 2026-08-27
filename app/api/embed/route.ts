import { NextResponse } from "next/server";

export const runtime = "nodejs";

const EMBED_TIMEOUT_MS = 45000;

type ProviderResult = { embedding: number[] } | { error: string };

/**
 * Провайдеры эмбеддингов:
 *  - Ollama (локально) — если EMBED_API_KEY не задан
 *  - OpenAI-совместимый API (OpenAI, Jina, LM Studio…) — если задан EMBED_API_KEY
 *
 * Важно: размерность должна совпадать с колонкой events.embedding (1024).
 * Для text-embedding-3-small и jina-embeddings-v3 передаём dimensions: 1024.
 */
async function embedViaOpenAiCompatible(text: string): Promise<ProviderResult> {
  const base = (
    process.env.EMBED_API_URL ?? "https://api.openai.com/v1"
  ).replace(/\/$/, "");
  const model = process.env.EMBED_MODEL ?? "text-embedding-3-small";
  const dim = Number(process.env.EMBED_DIM ?? 1024);

  try {
    const res = await fetch(`${base}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.EMBED_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        input: text.slice(0, 8000),
        dimensions: dim,
      }),
      signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 200);
      return {
        error: `${res.status} ${body || "ошибка провайдера эмбеддингов"}`,
      };
    }
    const json = await res.json();
    const emb = json.data?.[0]?.embedding;
    if (Array.isArray(emb) && emb.length > 0) return { embedding: emb };
    return { error: "Провайдер вернул пустой эмбеддинг" };
  } catch {
    return { error: "API эмбеддингов недоступен" };
  }
}

async function embedViaOllama(text: string): Promise<ProviderResult> {
  const base = (process.env.OLLAMA_URL ?? "http://localhost:11434").replace(
    /\/$/,
    "",
  );
  const model = process.env.OLLAMA_MODEL ?? "bge-m3";
  const input = text.slice(0, 4000);
  const attempts: { endpoint: string; status?: number; body?: string }[] = [];

  try {
    const res = await fetch(`${base}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input }),
      signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
    });
    if (res.ok) {
      const json = await res.json();
      const emb = json.embeddings?.[0];
      if (Array.isArray(emb) && emb.length > 0) return { embedding: emb };
    }
    attempts.push({
      endpoint: "/api/embed",
      status: res.status,
      body: (await res.text().catch(() => "")).slice(0, 200),
    });
  } catch {
    attempts.push({ endpoint: "/api/embed" });
  }

  try {
    const res = await fetch(`${base}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: input }),
      signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
    });
    if (res.ok) {
      const json = await res.json();
      if (Array.isArray(json.embedding) && json.embedding.length > 0) {
        return { embedding: json.embedding };
      }
    }
    attempts.push({
      endpoint: "/api/embeddings",
      status: res.status,
      body: (await res.text().catch(() => "")).slice(0, 200),
    });
  } catch {
    attempts.push({ endpoint: "/api/embeddings" });
  }

  if (attempts.every((a) => a.status === undefined)) {
    return {
      error: "Ollama не отвечает — запустите сервер: ollama serve",
    };
  }
  const notFound = attempts.find(
    (a) =>
      a.body?.toLowerCase().includes("not found") ||
      a.body?.toLowerCase().includes("не найдена"),
  );
  if (notFound) {
    return {
      error: `Модель не найдена. Выполните: ollama pull ${model}`,
    };
  }
  if (attempts.every((a) => a.status === 404)) {
    return { error: "Ollama старой версии — обновите: https://ollama.com/download" };
  }
  const detail = attempts
    .map((a) => `${a.endpoint}: ${a.status ?? "нет связи"} ${a.body ?? ""}`.trim())
    .join("; ");
  return { error: `Ollama вернула ошибку — ${detail}` };
}

export async function POST(req: Request) {
  let text: unknown;
  try {
    ({ text } = await req.json());
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }
  if (typeof text !== "string" || text.trim().length === 0) {
    return NextResponse.json(
      { error: "Поле text обязательно" },
      { status: 400 },
    );
  }

  const result = process.env.EMBED_API_KEY
    ? await embedViaOpenAiCompatible(text)
    : await embedViaOllama(text);

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json({
    embedding: result.embedding,
    dim: result.embedding.length,
  });
}
