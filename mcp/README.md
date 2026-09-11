# КейсПортал MCP

MCP-сервер для управления кейс-чемпионатами через ИИ-ассистента (Claude Desktop, Cursor и любой MCP-клиент).

## Инструменты

| Инструмент | Что делает |
|---|---|
| `create_event` | Мероприятие + кейсы + критерии одним вызовом (в т.ч. слепое судейство) |
| `get_events` | Список мероприятий со статистикой |
| `list_applications` | Заявки события: команды, статусы, воронка |
| `set_application_status` | Одобрить / отклонить / лист ожидания |
| `invite_judges` | Пригласить судей по e-mail |
| `get_works` | Решения события с баллами |
| `draft_scores` | Черновик оценок по критериям (подтверждает судья на портале) |
| `publish_results` | Опубликовать итоги |
| `export_report` | Отчёт: воронка, статистика, нормализованный лидерборд |
| `create_organization` / `invite_to_organization` / `transfer_event_to_organization` | Мультиарендность |

## Запуск

```bash
npm install
npm run build
```

Переменные окружения:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...   # anon/publishable ключ
MCP_ORG_EMAIL=organizer@example.com        # аккаунт организатора
MCP_ORG_PASSWORD=...
```

## Подключение к Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "caseportal": {
      "command": "node",
      "args": ["/abs/path/to/portalprojects/mcp/dist/index.js"],
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

Требуются миграции: `schema.sql` + `migration_organizations.sql` + `migration_scoring.sql`.

## Безопасность

Сервер работает под учёткой организатора — RLS ограничивает доступ только его событиями и организациями. Для продакшена заводите отдельный аккаунт «интеграций» с минимальными правами.
