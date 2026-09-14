#!/usr/bin/env node
// ============================================================
// Демо-данные КейсПортала (supabase/seed.sql).
//   npm run db:seed
// Идемпотентно: повторный запуск безопасен.
// Требуется DATABASE_URL в .env.local (см. db-migrate.mjs).
// ============================================================

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

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
loadEnvFile(join(root, ".env.local"));

let dbUrl = process.env.DATABASE_URL;
if (!dbUrl || dbUrl.includes("[YOUR-PASSWORD]")) {
  console.error(
    "Нужен DATABASE_URL в .env.local (с реальным паролем) — см. db-migrate.mjs",
  );
  process.exit(1);
}
if (dbUrl.includes(":6543/")) dbUrl = dbUrl.replace(":6543/", ":5432/");

const isLocal = dbUrl.includes("localhost") || dbUrl.includes("127.0.0.1");
const client = new pg.Client({
  connectionString: dbUrl,
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
});

try {
  await client.connect();
} catch (err) {
  console.error(`Не удалось подключиться: ${err.message}`);
  process.exit(1);
}

const seed = readFileSync(join(root, "supabase", "seed.sql"), "utf8");
const seedInventors = readFileSync(join(root, "supabase", "seed_inventors.sql"), "utf8");
try {
  await client.query("begin");
  await client.query(seed);
  await client.query(seedInventors);
  await client.query("commit");
  console.log("✓ Демо-данные загружены.");
  console.log("  Организатор: anna@demo.ru / demo1234");
  console.log("  Судьи: petr@demo.ru, maria@demo.ru (demo1234)");
  console.log("  Инвестор (одобрен): investor1@demo.ru / demo1234");
  console.log("  Инвестор (на модерации): investor2@demo.ru / demo1234");
  console.log("  Наставник (одобрен): mentor1@demo.ru / demo1234");
  console.log("  Наставник (на модерации): mentor2@demo.ru / demo1234");
} catch (err) {
  await client.query("rollback").catch(() => {});
  console.error(`✗ Сид не выполнен: ${err.message}`);
  if (err.detail) console.error(`  Детали: ${err.detail}`);
  process.exit(1);
} finally {
  await client.end();
}
