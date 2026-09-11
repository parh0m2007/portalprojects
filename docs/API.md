# КейсПортал — REST API v1

Базовый URL: `https://<домен>/api/v1`

## Аутентификация

API-ключ организации создаётся на портале (или RPC `create_api_key`).

```http
Authorization: Bearer cp_xxxxxxxxxxxxxxxx
```

Публичные GET-эндпоинты каталога работают и без ключа.

## Эндпоинты

| Метод | Путь | Доступ | Описание |
|---|---|---|---|
| GET | `/events` | публичный | Каталог опубликованных событий. `?limit=`, `?scope=mine` |
| GET | `/events/:id` | публичный | Событие: кейсы, критерии, статистика |
| GET | `/events/:id/registrations` | ключ | Заявки события (команды, статусы, решения) |
| GET | `/events/:id/leaderboard` | публичный* | `?mode=raw\|normalized` — итоги; `*` после публикации |
| GET | `/webhooks` | ключ (org) | Список webhook-подписок |
| POST | `/webhooks` | ключ (org) | `{ url, events? }` — создать подписку |
| DELETE | `/webhooks?id=` | ключ (org) | Удалить подписку |

## Webhooks

Типы событий:

- `registration.created`
- `registration.status_changed`
- `solution.uploaded`
- `results.published`

Каждый POST содержит заголовки:

```http
Content-Type: application/json
X-CasePortal-Event: registration.created
X-CasePortal-Signature: sha256=<HMAC-SHA256(body, secret)>
```

`secret` виден владельцу подписки при создании (таблица `api_webhooks.secret`).
Проверяйте подпись перед обработкой payload.

## Формат ответов

Успех: `{ "data": ... }`, ошибка: `{ "error": "invalid_api_key" }` (+ `details`).

## Ограничения

- `limit` не более 200
- Ключ отзывается на портале (revoked_at) — немедленно перестаёт работать
