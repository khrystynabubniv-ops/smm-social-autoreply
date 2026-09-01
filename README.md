# smm-social-autoreply

**Production:** https://smm-social-autoreply-production.up.railway.app

**Railway:** https://railway.com/project/e7a237ef-4c5a-4214-8586-260711e966b3/service/57fa1880-d6f7-40e3-914e-4148a2726a1c?environmentId=3fe93c72-876d-4705-9a3a-67ff58fc89f5

**Railway workspace:** khrystynabubniv-ops's Projects

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

| Variable                  | Опис                                                                                                                                                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`            | Postgres connection string                                                                                                                                                                                                                   |
| `META_APP_SECRET`         | **Instagram app secret** з App Dashboard → Products → Instagram → API setup with Instagram login (окремий App ID/secret, не головного застосунку). Перевірка `X-Hub-Signature-256`.                                                          |
| `META_VERIFY_TOKEN`       | Довільний рядок, вписуєш у Instagram → API setup with Instagram login → Configure webhooks → Verify Token.                                                                                                                                   |
| `META_PAGE_ACCESS_TOKEN`  | Instagram User Access Token (`IGAA...`) з кроку "2. Generate access tokens" на тому ж екрані. Дозволи `instagram_business_basic` + `instagram_business_manage_comments`. Виклики йдуть через `graph.instagram.com`, не `graph.facebook.com`. |
| `TELEGRAM_BOT_TOKEN`      | Токен бота від `@BotFather`.                                                                                                                                                                                                                 |
| `TELEGRAM_CHAT_ID`        | Chat id, куди слати сповіщення (наприклад, з `@userinfobot`).                                                                                                                                                                                |
| `TELEGRAM_WEBHOOK_SECRET` | Довільний секрет (`openssl rand -hex 32`), реєструється як `secret_token` у `setWebhook`.                                                                                                                                                    |

## Флоу

1. Meta шле подію (DM або коментар) на `POST /api/webhook/meta`.
2. Підпис перевіряється (`X-Hub-Signature-256` + `META_APP_SECRET`), подія
   парситься, зберігається в `IncomingEvent` (дедуплікація за `externalId`),
   і в Telegram-чат летить картка з пропонованою відповіддю.
3. `✅ Надіслати` → відповідь реально йде в Meta (коментарі через
   `instagram_business_manage_comments`, DM через `instagram_business_manage_messages`),
   статус → `sent`.
4. `✏️ Редагувати` → бот просить новий текст (`force_reply`), наступне
   повідомлення в чаті береться як чернетка і показується знову з кнопкою
   `✅ Надіслати цей варіант` (`send_edited`), яка зберігає фінальний текст і
   ставить статус → `edited_sent`.

## Налаштування Meta webhook

1. Публічний URL сервісу: `https://smm-social-autoreply-production.up.railway.app`
2. App Dashboard → Products → Instagram → **API setup with Instagram login** →
   "3. Configure webhooks" → **Callback URL**:
   `https://smm-social-autoreply-production.up.railway.app/api/webhook/meta`
3. **Verify Token**: значення з `META_VERIFY_TOKEN`.
4. Підписатись на поля `messages` (DM) та `comments`.

## Налаштування Telegram webhook

Обов'язково передавай `secret_token` (значення `TELEGRAM_WEBHOOK_SECRET`) — без нього
вебхук приймає запити лише з валідним заголовком і поверне 401 будь-кому іншому:

```bash
curl -F "url=https://smm-social-autoreply-production.up.railway.app/api/webhook/telegram" \
  -F "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
  "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook"
```

## Що НЕ реалізовано на цьому етапі

- AI-класифікація відповіді (OpenRouter) — заглушка
- Адмінка для шаблонів
- Multi-user логіка / locking — один Telegram chat, без auth
