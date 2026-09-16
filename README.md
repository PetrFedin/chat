# Chat — корпоративное рабочее пространство

`Chat` — самостоятельное multi-tenant приложение компании: регистрация организации, сотрудники и роли, каналы и личные сообщения, задачи, календарь, файлы, голосовые сообщения, realtime-присутствие, уведомления, аудио/видеозвонки и связанный контур исполнения.

## Рабочий граф

`Organization -> Workspace -> People -> Conversation -> Message/Call -> Task/Meeting/File -> Calendar -> Execution -> Evidence -> Acceptance`

Одна сущность показывается в нужных рабочих контекстах, а не копируется между разрозненными модулями.

## Текущий исполняемый слой v0.4

- регистрация компании и владельца;
- password auth на `scrypt` + opaque HttpOnly sessions;
- приглашения сотрудников по ссылке;
- роли `owner / admin / manager / member / guest` и server-side RBAC;
- REST API + `/openapi.json`;
- WebSocket realtime для presence, typing и событий workspace;
- каналы, группы и direct messages;
- replies, reactions, mentions и read cursor;
- local или S3-compatible object storage для файлов и voice;
- authenticated file downloads и inline preview для изображений, PDF и текста;
- browser MediaRecorder для голосовых сообщений;
- LiveKit-backed WebRTC/SFU audio/video calls;
- group calls, mic/camera controls, screen sharing и reconnect state;
- call state и participants хранятся в Chat, а не в SFU;
- запись встречи через LiveKit Egress только после consent всех активных участников;
- Web Push infrastructure при настроенных VAPID-ключах;
- задачи и календарные события через тот же API;
- installable mobile-first PWA с service worker и iOS safe areas;
- полноэкранная mobile call stage в общей тёмной дизайн-системе.

## Запуск

```bash
npm install
npm start
```

Откройте `http://localhost:3000` и зарегистрируйте компанию.

Без `DATABASE_URL` используется in-memory development store — данные сбрасываются после рестарта. Для постоянного многопользовательского режима примените миграции `001`–`006` и задайте:

```bash
DATABASE_URL=postgres://...
```

## Реальные аудио/видеозвонки

Без LiveKit приложение продолжает работать, но `/join` честно отвечает `MEDIA_PROVIDER_UNAVAILABLE`. Для настоящих звонков настройте LiveKit Cloud или self-hosted LiveKit:

```bash
LIVEKIT_URL=wss://your-livekit-host
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
```

Browser получает только short-lived participant token. `LIVEKIT_API_SECRET` никогда не отправляется клиенту. TURN/SFU transport обслуживается настроенной LiveKit-инфраструктурой.

## S3-compatible storage и запись встреч

Если `S3_BUCKET` не задан, обычные файлы сохраняются локально в `data/uploads` или `UPLOAD_DIR`. Если задан — файловый adapter автоматически переключается на S3-compatible storage:

```bash
S3_BUCKET=chat-production
S3_REGION=ru-1
S3_ENDPOINT=https://s3.example.com
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_FORCE_PATH_STYLE=false
```

Для записи встреч дополнительно:

```bash
LIVEKIT_EGRESS_ENABLED=true
```

LiveKit Egress пишет composite MP4 в тот же S3-compatible контур. После остановки `call_recordings.status` становится `processing`; поля `transcript_status` и `summary_status` уже предусмотрены, но transcription/AI worker не имитируется и является следующим production-блоком.

## Web Push

```bash
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:admin@example.com
```

## Security boundary

- пароли: `scrypt` + индивидуальная случайная salt;
- в БД хранится только SHA-256 hash session token;
- cookie: `HttpOnly`, `SameSite=Lax`, `Secure` в production;
- RBAC проверяется на серверной границе;
- private conversation realtime и calls доступны только участникам соответствующего разговора;
- LiveKit room имеет opaque name, не раскрывающий workspace ID;
- LiveKit join credential короткоживущий и выдаётся только authenticated member;
- file reads требуют authenticated workspace session;
- consequential call recording требует server-side consent всех активных участников;
- call creator/manager отдельно контролирует завершение звонка;
- Chat/PostgreSQL остаётся authoritative для участников, lifecycle и recording state; SFU отвечает только за media transport.

См. `docs/ARCHITECTURE.md`, `docs/PRODUCT_BLUEPRINT.md`, `docs/MULTIUSER_RUNTIME.md` и `docs/REALTIME_MEDIA.md`.
