# Chat — корпоративное рабочее пространство

`Chat` — самостоятельное multi-tenant приложение компании: регистрация организации, сотрудники и роли, каналы и личные сообщения, задачи, календарь, файлы, голосовые сообщения, realtime-присутствие, уведомления, аудио/видеозвонки, Meeting Intelligence и связанный контур исполнения.

## Рабочий граф

`Organization -> Workspace -> People -> Conversation -> Message/Call -> Task/Meeting/File -> Calendar -> Execution -> Evidence -> Acceptance`

Для встреч этот же граф продолжается без отдельного «AI-блокнота»:

`Call -> Consent -> Recording -> Transcript -> Summary -> Proposed decision/action -> Human confirmation -> Task -> Evidence`

Одна сущность показывается в нужных рабочих контекстах, а не копируется между разрозненными модулями.

## Текущий исполняемый слой

- регистрация компании и владельца;
- password auth на `scrypt` + opaque HttpOnly sessions;
- приглашения сотрудников по ссылке;
- роли `owner / admin / manager / member / guest` и server-side RBAC;
- REST API + `/openapi.json`;
- WebSocket realtime для presence, typing и событий workspace;
- каналы, группы и direct messages;
- replies, reactions, mentions и server-side read cursor;
- Daily Work: unread, mentions, Notification Center, permission-aware global search и Files;
- local или S3-compatible object storage для файлов и voice;
- authenticated file downloads и inline preview для изображений, PDF и текста;
- browser MediaRecorder для голосовых сообщений;
- LiveKit-backed WebRTC/SFU audio/video calls;
- group calls, mic/camera controls, screen sharing и reconnect state;
- call state и participants хранятся в Chat, а не в SFU;
- запись встречи через LiveKit Egress только после consent всех активных участников;
- evidence-first Meeting Intelligence: signed LiveKit webhook, durable jobs, timecoded transcript segments, summary, decisions/actions/risks/questions и source citations;
- Meeting Center с review-ready состоянием и переходом к конкретному фрагменту стенограммы;
- AI action не создаёт реальную задачу без отдельного подтверждения человеком;
- автоматический production worker для `transcribe` и `summarize` с durable claim, lease recovery, retry/dead-letter и graceful shutdown;
- Web Push infrastructure при настроенных VAPID-ключах;
- задачи и календарные события через тот же API;
- installable mobile-first PWA, RU/EN и dark/light themes.

## Запуск

```bash
npm install
npm start
```

Откройте `http://localhost:3000` и зарегистрируйте компанию.

Без `DATABASE_URL` используется in-memory development store — данные сбрасываются после рестарта. Для постоянного многопользовательского режима примените миграции `001`–`009` по порядку и задайте:

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

Для production-записи встреч дополнительно:

```bash
LIVEKIT_EGRESS_ENABLED=true
```

LiveKit Egress пишет composite MP4 в тот же S3-compatible контур. `egress_ended` принимается только через подписанный LiveKit webhook; после успешного terminal state запись переводится в `ready` и durable transcription job становится доступен worker'у.

## Meeting Intelligence provider runtime

Provider selection сделан явным. Наличие API key само по себе ничего не включает: если provider variables не заданы, pipeline остаётся fail-closed и не создаёт фиктивные стенограммы/summary.

Для OpenAI transcription + summary:

```bash
OPENAI_API_KEY=...
MEETING_TRANSCRIPTION_PROVIDER=openai
MEETING_SUMMARY_PROVIDER=openai

# optional
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe-diarize
OPENAI_MEETING_SUMMARY_MODEL=gpt-5.6
OPENAI_MEETING_SUMMARY_REASONING=low
MEETING_TRANSCRIPTION_LANGUAGE=ru
MEETING_TRANSCRIPTION_TIMEOUT_MS=180000
MEETING_SUMMARY_TIMEOUT_MS=180000
```

Transcription adapter запрашивает `diarized_json` и `chunking_strategy=auto`, затем сохраняет speaker-labelled segments с `startMs/endMs`. Summary adapter использует Responses API + strict JSON Schema и отправляет `store:false`. Все предложения дополнительно фильтруются repository layer: proposal без существующего transcript segment source не материализуется.

Worker включён по умолчанию в обычном server runtime, но выполняет работу только для реально настроенных providers:

```bash
MEETING_WORKER_ENABLED=true
MEETING_WORKER_POLL_MS=1500
MEETING_WORKER_PROVIDER_WAIT_MS=30000
MEETING_WORKER_SHUTDOWN_MS=5000
```

Несколько экземпляров приложения могут polling-ить одну PostgreSQL queue: claim использует `FOR UPDATE SKIP LOCKED`, а lock token + bounded lease не дают двум workers подтвердить один job. При аварийном завершении stale processing job восстанавливается после lease timeout.

`GET /healthz` показывает отдельно webhook, processor и worker state, включая активные provider lanes и последний результат обработки.

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
- private conversation realtime, calls, files, transcripts и proposals доступны только соответствующему audience;
- LiveKit room имеет opaque name, не раскрывающий workspace ID;
- LiveKit join credential короткоживущий и выдаётся только authenticated member;
- consequential call recording требует server-side consent всех активных участников;
- LiveKit webhook проверяется официальным JWT + exact-body SHA contract;
- запись валидируется в object storage до transcription, а SHA-256 исходных bytes сохраняется в intelligence run;
- AI proposals не являются authoritative work: responsibility, promised date и создание task подтверждаются человеком;
- Chat/PostgreSQL остаётся authoritative для lifecycle и work graph; LiveKit отвечает за media transport/Egress, AI provider — только за предложенную интерпретацию доказательств.

См. `docs/ARCHITECTURE.md`, `docs/PRODUCT_BLUEPRINT.md`, `docs/MULTIUSER_RUNTIME.md`, `docs/REALTIME_MEDIA.md` и `docs/MEETING_INTELLIGENCE.md`.
