# Восстановление пароля по email (Resend)

Дата: 2026-07-22

## Цель

Дать пользователю возможность сбросить забытый пароль через письмо со ссылкой,
не поднимая собственный почтовый сервер. Доставка писем — через транзакционный
провайдер Resend (HTTP API, бесплатный тариф). Свежий бэкенд не имел ни email-,
ни reset-инфраструктуры — добавляем её с нуля.

## Область (scope)

Только бэкенд (NestJS). Фронтенд-страницы сброса пока нет — базовый URL страницы
задаётся через `.env` (`FRONTEND_RESET_URL`), фронт подключится позже.

Вне области: смена пароля из профиля (авторизованный кейс), rate-limiting
(нет throttler в проекте — не вводим новую инфраструктуру), верификация email
при регистрации.

## Компоненты

### 1. Сущность `PasswordReset` + миграция

Таблица `password_resets`:

| поле | тип | назначение |
|---|---|---|
| `id` | uuid PK | |
| `userId` | uuid | чей сброс (FK → users, ON DELETE CASCADE) |
| `tokenHash` | varchar(64) | SHA-256 (hex) от сырого токена; сам токен в БД не хранится |
| `expiresAt` | timestamp | `now() + 30 мин` |
| `usedAt` | timestamp null | отметка одноразового использования |
| `createdAt` | timestamp | `now()` |

Индекс по `tokenHash` для быстрого поиска при сбросе.
Миграция `1700000000029-CreatePasswordResets` в стиле существующих (raw SQL,
`uuid_generate_v4()`, явные имена constraint'ов).

### 2. `MailModule` / `MailService` (`src/mail/`)

Метод `sendPasswordResetEmail(email: string, resetUrl: string): Promise<void>`.

- Провайдер — Resend, ключ `RESEND_API_KEY` из `.env`.
- `from` из `MAIL_FROM` (по умолчанию `onboarding@resend.dev` — sandbox Resend,
  работает без DNS).
- **Dev-fallback:** если `RESEND_API_KEY` не задан или пакет `resend` недоступен —
  ссылка печатается в лог (`Logger.warn`), исключение не бросается. Это позволяет
  фиче работать сразу, до получения ключа, и не ломать сборку.
- Пакет `resend` подключается через динамический `require` внутри try/catch,
  чтобы отсутствие пакета не ломало компиляцию TypeScript.
- Модуль экспортирует `MailService`, импортируется в `AuthModule`.

### 3. DTO

- `ForgotPasswordDto { email: string }` — `@IsEmail`.
- `ResetPasswordDto { token: string; newPassword: string }` — `token` непустой;
  `newPassword` — те же правила, что пароль в `RegisterDto` (`@IsString`,
  `@MinLength(8)`, `@MaxLength(64)`).

### 4. Логика (`AuthService`)

**`requestPasswordReset(email: string): Promise<void>`**
1. Найти пользователя по email. Если нет — тихо выйти (без ошибки).
2. Сгенерировать сырой токен `crypto.randomBytes(32).toString('hex')` (256 бит).
3. Удалить прежние неиспользованные записи сброса этого пользователя.
4. Сохранить `PasswordReset` с `tokenHash = sha256(raw)` и `expiresAt = now + 30 мин`.
5. Собрать `resetUrl = ${FRONTEND_RESET_URL}?token=${raw}`.
6. Вызвать `mailService.sendPasswordResetEmail(email, resetUrl)`.

**`resetPassword(token: string, newPassword: string): Promise<void>`**
1. `tokenHash = sha256(token)`.
2. Найти запись, где `tokenHash` совпадает, `usedAt IS NULL`, `expiresAt > now`.
3. Не найдена → `BadRequestException` («ссылка недействительна или устарела»).
4. `usersService.changePassword(record.userId, newPassword)` (уже существует).
5. Пометить `usedAt = now()`.

### 5. Эндпоинты (`AuthController`), оба `@Public()`

- `POST /auth/forgot-password` `{ email }` → **всегда** `200` с одинаковым
  сообщением (нет user-enumeration). Вызывает `requestPasswordReset`.
- `POST /auth/reset-password` `{ token, newPassword }` → `200` при успехе,
  `400` если токен неверный / просрочен / уже использован.

## Поток данных

```
Пользователь → POST /auth/forgot-password {email}
  → AuthService: токен, hash в БД, письмо со ссылкой (Resend / лог)
Пользователь кликает ссылку → (будущая фронт-страница) собирает newPassword
  → POST /auth/reset-password {token, newPassword}
  → AuthService: валидация токена → changePassword → usedAt=now
```

## Безопасность

- Токен 256-бит; в БД только SHA-256 — утечка БД не даёт рабочих токенов.
- Срок жизни 30 минут; строго одноразовый (`usedAt`).
- Новый запрос гасит прежние неиспользованные токены пользователя.
- `forgot-password` не раскрывает существование email (одинаковый ответ).
- Пароль валидируется теми же правилами, что при регистрации.

## Новые переменные окружения

- `RESEND_API_KEY` — ключ Resend (без него — dev-fallback в лог).
- `MAIL_FROM` — адрес отправителя (default `onboarding@resend.dev`).
- `FRONTEND_RESET_URL` — базовый URL страницы сброса на фронте
  (например `https://optparts.kz/reset-password`).

## Тестирование

- Unit: `AuthService.resetPassword` — просроченный / использованный / неверный
  токен → ошибка; валидный → пароль сменён и токен погашен.
- Smoke (curl):
  1. `POST /auth/forgot-password` → 200; при пустом `RESEND_API_KEY` ссылка в логе.
  2. Взять токен из лога → `POST /auth/reset-password` → 200.
  3. `POST /auth/login` с новым паролем → 200.
  4. Повтор `reset-password` тем же токеном → 400 (одноразовость).

## Развёртывание

`npm run build` → `npm run migration:run` → перезапуск процесса
(см. память live-port-topology: prod backend на :3100).
Добавить новые ключи в `.env`. Установить пакет: `npm install resend`.
