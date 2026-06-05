# Деплой на Render — пошаговая инструкция

## 1. Заполни .env локально (проверь что работает)

Открой `.env` и вставь свои ключи:

```
GROQ_API_KEYS=gsk_ключ1,gsk_ключ2,gsk_ключ3
TELEGRAM_BOT_TOKEN=токен_от_BotFather
```

Проверь локально:
```bash
npm start          # в корне — должно написать "Server running at http://localhost:3000"
cd client && npm run dev   # в другом терминале
```

---

## 2. Залей проект на GitHub

```bash
# В корне проекта
git init
git add .
git commit -m "initial commit"
```

Создай репозиторий на github.com (New repository), затем:

```bash
git remote add origin https://github.com/ТВО_ИМЯ/kwork-bot.git
git branch -M main
git push -u origin main
```

> ⚠️ Убедись что `.env` есть в `.gitignore` — он не должен попасть в репо!

Создай `.gitignore` если его нет:
```
node_modules/
client/node_modules/
client/dist/
.env
server/logs/
server/data.db
server/data.db-shm
server/data.db-wal
```

---

## 3. Создай сервис на Render

1. Зайди на [render.com](https://render.com) → войди/зарегистрируйся
2. Нажми **New → Web Service**
3. Подключи GitHub → выбери репозиторий `kwork-bot`
4. Render автоматически подхватит `render.yaml` — настройки уже прописаны

Если не подхватил вручную:
- **Build Command:** `npm run render-build`
- **Start Command:** `npm start`
- **Node version:** 18+

---

## 4. Добавь переменные окружения на Render

В разделе **Environment → Environment Variables** добавь:

| Key | Value |
|-----|-------|
| `GROQ_API_KEYS` | `gsk_ключ1,gsk_ключ2,gsk_ключ3` |
| `TELEGRAM_BOT_TOKEN` | `токен_от_BotFather` |
| `NODE_ENV` | `production` |

Claude API — только если используешь:

| Key | Value |
|-----|-------|
| `CLAUDE_API_KEY` | `sk-ant-...` |

---

## 5. Настрой Persistent Disk (важно!)

База данных SQLite хранится на диске — без него данные сбрасываются при каждом рестарте.

На Render (Free план диск недоступен, нужен минимум **Starter $7/мес**):

1. В настройках сервиса → **Disks → Add Disk**
2. **Name:** `data`
3. **Mount Path:** `/opt/render/project/src/server`
4. **Size:** 1 GB

> На **Free плане** данные будут теряться при рестарте. Для продакшна нужен платный план.

---

## 6. Задеплой

Нажми **Deploy** — Render сам:
1. Установит зависимости (`npm install`)
2. Соберёт клиент (`cd client && npm run build`)
3. Запустит сервер (`npm start`)

Билд занимает ~2-3 минуты.

---

## 7. Настрой Telegram бота

После деплоя бот автоматически переключится с polling на webhook.

Проверь что бот работает — напиши ему `/start` в Telegram.

Если бот не отвечает:
- Проверь `TELEGRAM_BOT_TOKEN` в переменных Render
- Открой логи сервиса (вкладка **Logs**) — ищи строку `[TG]`

---

## 8. Проверь что всё работает

- Открой URL сервиса (вида `https://kwork-bot.onrender.com`)
- Нажми **▶ Start** — парсинг должен запуститься
- Напиши `/start` боту в Telegram — должен ответить статистикой

---

## Частые проблемы

| Проблема | Решение |
|----------|---------|
| Белый экран на сайте | Убедись что `client/dist/` собрался — проверь билд-логи |
| Groq ошибка ключа | Добавь ключи через UI → Настройки → Groq API Ключи |
| Бот не отвечает | Проверь токен, посмотри логи на Render |
| Данные пропали после рестарта | Нужен Persistent Disk (платный план) |
| `EPIPE` ошибки в логах | Это норма — просто WebSocket шум, не влияет на работу |
