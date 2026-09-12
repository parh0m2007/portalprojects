#!/usr/bin/env node
// ============================================================
// Автоматические миграции КейсПортала.
//
// Применяет supabase/migrations/*.sql к БД Supabase напрямую по
// протоколу Postgres (DATABASE_URL) — как supabase db push, но без
// требований к токенам и правам Management API.
//
// Использование:
//   npm run db:migrate            — применить все неприменённые
//   npm run db:migrate -- --dry   — показать очередь без выполнения
//   npm run db:migrate -- --force — повторить последнюю миграцию
//
// Требуется DATABASE_URL в .env.local — строка подключения
// (Dashboard → Connect → Session pooler, порт 5432) с паролем БД
// вместо [YOUR-PASSWORD].
//
// Журнал: public.schema_migrations — применённое не повторяется,
// порядок строго по имени файла. Каждый файл выполняется атомарно
// (BEGIN…COMMIT): ошибка откатывает весь файл целиком.
// Все миграции идемпотентны — безопасный повторный запуск.
// ============================================================

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------- .env.local ----------
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

const DRY = process.argv.includes("--dry");
const FORCE = process.argv.includes("--force");

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

// ---------- Подключение ----------
let dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  fail(
    "Нет DATABASE_URL в .env.local.\n\n" +
      "Как получить (2 минуты):\n" +
      "  1. Supabase Dashboard → ваш проект → Connect\n" +
      "  2. Вкладка «Session pooler» (порт 5432) → скопируйте URI\n" +
      "     postgresql://postgres.<ref>:...@aws-0-<region>.pooler.supabase.com:5432/postgres\n" +
      "  3. Замените [YOUR-PASSWORD] на пароль БД\n" +
      "     (Settings → Database → Database password)\n" +
      "  4. Добавьте строку в .env.local:\n" +
      "     DATABASE_URL=postgresql://...:пароль@...pooler.supabase.com:5432/postgres",
  );
}
if (dbUrl.includes("[YOUR-PASSWORD]")) {
  fail("В DATABASE_URL остался плейсхолдер [YOUR-PASSWORD] — замените на пароль БД.");
}

// transaction pooler (6543) не поддерживает многооператорные запросы —
// меняем на session pooler (5432)
if (dbUrl.includes(":6543/")) {
  dbUrl = dbUrl.replace(":6543/", ":5432/");
  console.log("Порт 6543 (transaction pooler) заменён на 5432 (session pooler).");
}

const isLocal = dbUrl.includes("localhost") || dbUrl.includes("127.0.0.1");
const client = new pg.Client({
  connectionString: dbUrl,
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
});

try {
  await client.connect();
} catch (err) {
  fail(
    `Не удалось подключиться к БД: ${err.message}\n` +
      "Проверьте DATABASE_URL и пароль базы (Settings → Database).",
  );
}

// ---------- Журнал миграций ----------
const JOURNAL = "public.schema_migrations";

await client.query(
  `create table if not exists ${JOURNAL} (
     name       text primary key,
     applied_at timestamptz not null default now()
   )`,
);
const applied = new Set(
  (await client.query(`select name from ${JOURNAL} order by name`)).rows.map(
    (r) => r.name,
  ),
);

// ---------- Очередь ----------
const dir = join(root, "supabase", "migrations");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.log("В supabase/migrations нет .sql файлов.");
  await client.end();
  process.exit(0);
}

console.log(`Миграций найдено: ${files.length}, применено ранее: ${applied.size}`);

let pending = files.filter((f) => !applied.has(f));
if (FORCE && pending.length < files.length) {
  const last = files.filter((f) => applied.has(f)).pop();
  if (last) pending.push(last);
}

if (pending.length === 0) {
  console.log("✓ Всё актуально — новых миграций нет.");
  await client.end();
  process.exit(0);
}

console.log(`К применению: ${pending.length}`);
for (const f of pending) console.log(`  • ${f}`);

if (DRY) {
  console.log("\n--dry: ничего не выполнялось.");
  await client.end();
  process.exit(0);
}

// ---------- Применение ----------
let done = 0;
for (const [i, file] of pending.entries()) {
  process.stdout.write(`[${i + 1}/${pending.length}] ${file} … `);
  const content = readFileSync(join(dir, file), "utf8");
  try {
    await client.query("begin");
    await client.query(content);
    await client.query("commit");
    await client.query(
      `insert into ${JOURNAL} (name) values ($1)
       on conflict (name) do nothing`,
      [file],
    );
    done++;
    console.log("✓");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    console.log("✗");
    console.error(`\nОшибка в ${file}:\n  ${err.message}`);
    if (err.detail) console.error(`  Детали: ${err.detail}`);
    if (err.hint) console.error(`  Подсказка: ${err.hint}`);
    console.error(
      "\nФайл откачен целиком (BEGIN…ROLLBACK) — БД в прежнем состоянии.\n" +
        "Все миграции идемпотентны: исправьте файл и повторите\n" +
        "  npm run db:migrate\n" +
        "— продолжит с этого же файла.",
    );
    await client.end();
    process.exit(1);
  }
}

await client.end();
console.log(`\nГотово: применено ${done} из ${pending.length}.`);
console.log("Дальше (опционально): npm run db:seed — демо-данные.");
