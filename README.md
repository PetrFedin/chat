# Chat — корпоративное рабочее пространство

`Chat` — самостоятельное multi-tenant приложение компании: регистрация организации, сотрудники и роли, каналы и личные сообщения, задачи, календарь, файлы, голосовые сообщения, realtime-присутствие, уведомления и связанный контур исполнения.

## Рабочий граф

`Organization -> Workspace -> People -> Conversation -> Message -> Task/Meeting/File -> Calendar -> Execution -> Evidence -> Acceptance`

Одна сущность показывается в нужных рабочих контекстах, а не копируется между разрозненными модулями.

## Текущий исполняемый слой v0.3

- регистрация компании и владельца;
- password auth на `scrypt` + opaque HttpOnly sessions;
- приглашения сотрудников по ссылке;
- роли `owner / admin / manager / member / guest` и RBAC;
- REST API + `/openapi.json`;
- WebSocket realtime для presence, typing и событий workspace;
- каналы, группы и direct messages;
- replies, reactions, mentions и read cursor;
- загрузка/выдача файлов только внутри authenticated workspace;
- запись голосовых сообщений через browser MediaRecorder;
- Web Push infrastructure при настроенных VAPID-ключах;
- задачи и календарные события через тот же API;
- installable mobile-first PWA с service worker и iOS safe areas.

Аудио/видео call-domain уже существует в схеме. Реальный WebRTC/TURN/SFU transport намеренно не имитируется: это следующий media-runtime слой.

## Запуск

```bash
npm install
npm start
```

Откройте `http://localhost:3000` и зарегистрируйте компанию.

Без `DATABASE_URL` используется in-memory development store — данные сбрасываются после рестарта. Для постоянного многопользовательского режима примените миграции `001`–`005` и задайте:

```bash
DATABASE_URL=postgres://...
```

Для фоновых Web Push:

```bash
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:admin@example.com
```

Файлы по умолчанию сохраняются в `data/uploads`; путь можно заменить через `UPLOAD_DIR`. Следующий production adapter — S3-compatible object storage с quarantine/antivirus worker.

## Security boundary

- пароли: `scrypt` + индивидуальная случайная salt;
- в БД хранится только SHA-256 хеш session token;
- cookie: `HttpOnly`, `SameSite=Lax`, `Secure` в production;
- RBAC проверяется на серверной границе;
- private conversation realtime рассылается только участникам;
- file reads требуют authenticated workspace session;
- consequential call recording требует согласия участников в call-domain.

См. `docs/ARCHITECTURE.md`, `docs/PRODUCT_BLUEPRINT.md` и `docs/MULTIUSER_RUNTIME.md`.
