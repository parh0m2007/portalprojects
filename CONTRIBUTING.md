# Как внести вклад

Спасибо за интерес к КейсПорталу!

## Разработка

```bash
git clone <repo> && cd portalprojects
npm install
cp .env.example .env.local   # заполните ключами Supabase
npm run db:migrate          # применить миграции
npm run db:seed             # демо-данные (опционально)
npm run dev
```

## Правила

1. **Ветки**: работайте в `feat/<название>` или `fix/<название>`
2. **Коммиты**: [Conventional Commits](https://www.conventionalcommits.org/ru/) —
   `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`
3. **Проверки перед PR**:
   ```bash
   npm run lint    # 0 ошибок
   npm run build   # сборка зелёная
   ```
4. **Миграции БД**: новые — в `supabase/migrations/` с таймстамп-префиксом
   (формат `YYYYMMDDHHMMSS_название.sql`), идемпотентно (`if not exists`,
   `drop ... if exists`), каждая — атомарно.
5. **Секреты**: никогда не коммитить `.env.local`, ключи, пароли.

## Структура для навигации

- UI — `app/`, `components/`
- Логика данных — `lib/`
- Миграции — `supabase/migrations/`
- MCP-сервер — `mcp/`
- REST API — `app/api/v1/`, доку — `docs/API.md`

## Репорт багов

Создайте Issue с шаблоном: что произошло, шаги воспроизведения,
ожидание vs реальность, окружение (браузер, Node.js).
