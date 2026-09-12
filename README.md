<div align="center">

# 🏆 КейсПортал

**Платформа для проведения кейс-чемпионатов и лекций**
от регистрации команд до дипломов — с ИИ-ассистентом организатора

[![Next.js](https://img.shields.io/badge/Next.js%2016-black?logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React%2019-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?logo=supabase&logoColor=black)](https://supabase.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![MCP](https://img.shields.io/badge/MCP-server-7c3aed)](mcp/)
[![License: MIT](https://img.shields.io/badge/License-MIT-gold.svg)](LICENSE)

[Возможности](#возможности) · [Быстрый старт](#быстрый-старт) · [MCP](#mcp-сервер--ии-ассистент-организатора) · [REST API](#rest-api-v1--webhooks) · [Архитектура](#структура-проекта)

</div>

---

## Что это

Организатор публикует кейс-чемпионат или лекцию → команды регистрируются и выбирают кейсы → загружают решения → жюри оценивает по критериям (вслепую!) → таблица лидеров с честной нормализацией оценок → дипломы участникам.

При этом организатор может вообще **не открывать браузер** — весь цикл управляется через ИИ-ассистента (Claude, Cursor) по протоколу **MCP**.

### Ключевые фишки

| | |
|---|---|
| 🧠 **Умная лента** | персональные скоринги: теги интересов + нейро-эмбеддинги BGE-M3 (pgvector), затухание сигналов по времени, «с этим событием также» |
| 🕶️ **Слепое судейство** | судьи не видят авторство работ до публикации итогов — оценка без предвзятости |
| ⚖️ **Нормализация оценок** | z-score калибровка компенсирует «строгих» и «щедрых» судей, индекс 0–100 |
| 🏢 **Мультиарендность** | организации с ролями owner / admin / manager, командная работа над событиями |
| 🤖 **MCP-сервер** | 12 инструментов для ИИ-ассистента: события, заявки, судьи, итоги, отчёты |
| 🔌 **REST API + Webhooks** | интеграция с HR-системами, HMAC-подпись событий |
| 🔒 **RLS везде** | Row Level Security на всех таблицах, ключи хранятся как sha256 |

## Возможности

<details>
<summary><b>Для участников</b> (раскрыть)</summary>

- витрина событий с персональными рекомендациями и поиском по смыслу
- регистрация команды с выбором кейса, лист ожидания при лимите мест
- загрузка решений (Supabase Storage), отслеживание статуса заявки
- таблица лидеров: обычные баллы и нормализованный индекс
- автоматические дипломы участников
- календарь событий, избранное, подписки на организаторов
- внутренние уведомления на все ключевые события

</details>

<details>
<summary><b>Для организаторов</b> (раскрыть)</summary>

- создание мероприятий: кейсы, критерии оценки, темы, обложки, лимит мест
- слепое судейство одним переключателем
- приглашение судей по e-mail, подтверждение с их стороны
- дашборд: воронка заявок, статистика решений, состав жюри, экспорт XLSX
- публикация итогов → решения и оценки становятся публичными
- организации: несколько организаторов ведут общие события

</details>

<details>
<summary><b>Интеграции</b> (раскрыть)</summary>

- **MCP** ([mcp/](mcp/)) — управление чемпионатами через Claude Desktop / Cursor
- **REST API v1** ([docs/API.md](docs/API.md)) — события, заявки, лидерборды
- **Webhooks** — `registration.created`, `solution.uploaded`, `results.published` с HMAC-подписью
- **API-ключи** — sha256-хэш, мгновенный отзыв

</details>

## Быстрый старт

### 1. Supabase

Создайте проект на [supabase.com](https://supabase.com), затем:
**Dashboard → Connect → Session pooler** (порт 5432) → скопируйте URI,
замените `[YOUR-PASSWORD]` на пароль БД (**Settings → Database**).

### 2. Переменные окружения

```bash
cp .env.example .env.local
# заполните: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
#             DATABASE_URL (для миграций)
```

### 3. Миграции — автоматически

```bash
npm install
npm run db:migrate        # все миграции из supabase/migrations (журнал версий в БД)
npm run db:seed           # опционально: демо-данные (anna@demo.ru / demo1234)
```

Каждая миграция выполняется атомарно (`BEGIN…COMMIT`) — при ошибке
файл откатывается целиком. Новые миграции просто кладите в
`supabase/migrations/` — скрипт применит только их.

### 4. Портал

```bash
npm run dev               # http://localhost:3000
```

<details>
<summary><b>Опционально: умная лента и API</b></summary>

```bash
# нейро-эмбеддинги ленты (локально):
ollama serve && ollama pull bge-m3
npm run embed:backfill

# REST API /api/v1 и webhooks — добавьте в .env.local:
SUPABASE_SECRET_KEY=sb_secret_...
```

</details>

## MCP-сервер — ИИ-ассистент организатора

```bash
cd mcp && npm install && npm run build
```

Подключение к Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "caseportal": {
      "command": "node",
      "args": ["/путь/к/порталу/mcp/dist/index.js"],
      "env": {
        "NEXT_PUBLIC_SUPABASE_URL": "https://xxxx.supabase.co",
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": "eyJ...",
        "MCP_ORG_EMAIL": "organizer@example.com",
        "MCP_ORG_PASSWORD": "..."
      }
    }
  }
}
```

12 инструментов: `create_event` (событие + кейсы + критерии одним вызовом),
заявки и статусы, `invite_judges`, `get_works`, `draft_scores` (черновик оценок),
`publish_results`, `export_report`, организации. Подробности: [mcp/README.md](mcp/README.md).

Пример в чате: *«Создай кейс-чемпионат по аналитике с кейсами "Прогноз погоды"
и "Рекомендации", критериями Сложность 10 и Практичность 10, слепое судейство
включено, пригласи судей petr@… и maria@…»*

## REST API v1 + Webhooks

```bash
curl http://localhost:3000/api/v1/events?limit=5                    # каталог (публично)
curl -H "Authorization: Bearer cp_..." /api/v1/events/:id/registrations
curl /api/v1/events/:id/leaderboard?mode=normalized                 # z-score рейтинг
```

Ключ: RPC `create_api_key` → `cp_...` (показывается один раз).
Webhooks с подписью `X-CasePortal-Signature: sha256=<HMAC>`.
Полная документация: **[docs/API.md](docs/API.md)**.

## Структура проекта

```
app/
  page.tsx                      витрина: hero + умная лента
  events/[id]                   событие, кейсы, регистрация
  leaderboard                   таблица лидеров (raw / normalized)
  calendar, works, diploma/     календарь, галерея работ, дипломы
  join/[code], join/org/[token] приглашения в команду / организацию
  my/                           дашборд организатора
    orgs/                       организации: создание, участники, приглашения
    events/new                  создание события (кейсы, критерии, слепое судейство)
    events/[id]                 статистика, заявки, решения, судьи
    registrations               мои заявки + загрузка решений
  judge/                         панель судьи (анонимизированные карточки работ)
  api/v1/                        REST API: events, registrations, leaderboard, webhooks
  api/embed                      эмбеддинги (Ollama / OpenAI-совместимый API)
lib/                             supabase, auth, api-key middleware
mcp/                             MCP-сервер для ИИ-ассистентов (12 инструментов)
supabase/
  migrations/                   нумерованные миграции (автоприменение)
  seed.sql                      демо-данные
scripts/
  db-migrate.mjs                npm run db:migrate — автоматические миграции
  db-seed.mjs                   npm run db:seed
  backfill-embeddings.mjs       бэкфилл эмбеддингов
docs/API.md                     REST API v1
```

## Безопасность

- **RLS** на всех таблицах; сервисная роль — только на сервере для проверки API-ключей
- API-ключи: sha256-хэш в БД, мгновенный отзыв, пространство: организация или пользователь
- Webhooks: HMAC-SHA256 с уникальным секретом на подписку
- MCP работает под учёткой организатора — RLS ограничивает только его данными

## Команды

| Команда | Назначение |
|---|---|
| `npm run dev` | dev-сервер портала |
| `npm run build` / `npm start` | прод-сборка |
| `npm run lint` | ESLint |
| `npm run db:migrate` | применить миграции (атомарно, с журналом) |
| `npm run db:migrate -- --dry` | показать очередь без выполнения |
| `npm run db:seed` | демо-данные |
| `npm run embed:backfill` | эмбеддинги событий |
| `cd mcp && npm run build` | сборка MCP-сервера |

## Роли и доступ (RLS)

| Роль | Права |
|---|---|
| Аноним | читает опубликованные события, кейсы, лидеров |
| Пользователь | регистрируется, создаёт события, видит свои заявки/решения |
| Член организации | управляет событиями организации (owner/admin/manager) |
| Судья | видит решения, ставит оценки; при слепом судействе — без авторства |

## Лицензия

[MIT](LICENSE)

---

<div align="center">

**КейсПортал** — чемпионаты без рутины 🚀

</div>
