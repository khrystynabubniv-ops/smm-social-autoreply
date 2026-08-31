export default function Home() {
  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        padding: "3rem",
        maxWidth: 640,
      }}
    >
      <h1>smm-social-autoreply</h1>
      <p>
        Сервіс приймає вебхуки Meta (Instagram DM / коментарі) і надсилає
        пропоновані відповіді на підтвердження в Telegram.
      </p>
      <ul>
        <li>
          <code>GET/POST /api/webhook/meta</code> — вебхук Meta
        </li>
        <li>
          <code>POST /api/webhook/telegram</code> — вебхук Telegram-бота
        </li>
        <li>
          <code>GET /api/health</code> — health check
        </li>
      </ul>
      <p>Деталі налаштування — у README репозиторію.</p>
    </main>
  );
}
