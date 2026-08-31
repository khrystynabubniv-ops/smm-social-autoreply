# smm-social-autoreply

MVP-прототип: приймає вхідні Instagram DM та коментарі через Meta webhook,
надсилає в Telegram-чат картку з пропонованою відповіддю та кнопками
підтвердження (`✅ Надіслати` / `✏️ Редагувати`), і за підтвердженням
відправляє відповідь назад у Meta.

На цьому етапі **без AI-класифікації** — `proposedReply` це заглушка
(`[тут буде пропонована відповідь]`), щоб перевірити флоу end-to-end і
записати скрінкаст для Meta App Review. AI-класифікацію додамо окремим
кроком пізніше.

## Стек

- Next.js (App Router) + TypeScript
- PostgreSQL + Prisma
- Прямі HTTP-виклики до Telegram Bot API (без сторонніх бібліотек)
- Railway (деплой, окремий сервіс)

## Локальний запуск

```bash
npm install
cp .env.example .env
# заповнити .env.local реальними значеннями (див. нижче)
npm run prisma:migrate
npm run dev
```

Health check: `curl http://localhost:3000/api/health`

## Env variables

| Variable                 | Опис                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`           | Postgres connection string                                                                                |
| `META_APP_SECRET`        | Meta App Dashboard → Settings → Basic → App Secret. Використовується для перевірки `X-Hub-Signature-256`. |
| `META_VERIFY_TOKEN`      | Довільний рядок, який ти сам придумуєш і вписуєш у Meta App Dashboard → Webhooks.                         |
| `META_PAGE_ACCESS_TOKEN` | Page access token з правами `instagram_manage_comments` (і згодом `instagram_manage_messages`).           |
| `TELEGRAM_BOT_TOKEN`     | Токен бота від `@BotFather`.                                                                              |
| `TELEGRAM_CHAT_ID`       | Chat id, куди слати сповіщення (наприклад, з `@userinfobot`).                                             |

## Флоу

1. Meta шле подію (DM або коментар) на `POST /api/webhook/meta`.
2. Підпис перевіряється (`X-Hub-Signature-256` + `META_APP_SECRET`), подія
   парситься, зберігається в `IncomingEvent` (дедуплікація за `externalId`),
   і в Telegram-чат летить картка з пропонованою відповіддю.
3. `✅ Надіслати` → відповідь іде в Meta (реально для коментарів через
   `instagram_manage_comments`; для DM поки що лише `console.log`, бо
   `instagram_manage_messages` ще не підтверджено), статус → `sent`.
4. `✏️ Редагувати` → бот просить новий текст (`force_reply`), наступне
   повідомлення в чаті береться як чернетка і показується знову з кнопкою
   `✅ Надіслати цей варіант` (`send_edited`), яка зберігає фінальний текст і
   ставить статус → `edited_sent`.

## Налаштування Meta webhook

Після деплою на Railway:

1. Публічний URL сервісу: `https://<railway-domain>` (буде виведено після
   деплою).
2. Meta App Dashboard → Webhooks → Instagram → **Callback URL**:
   `https://<railway-domain>/api/webhook/meta`
3. **Verify Token**: значення з `META_VERIFY_TOKEN`.
4. Підписатись на поля `messages` (DM) та `comments`.

## Налаштування Telegram webhook

```bash
curl -F "url=https://<railway-domain>/api/webhook/telegram" \
  "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook"
```

## Що НЕ реалізовано на цьому етапі

- AI-класифікація відповіді (OpenRouter) — заглушка
- Адмінка для шаблонів
- Реальна відправка в Instagram DM (тільки лог); коментарі — реальна відправка
- Multi-user логіка / locking — один Telegram chat, без auth
