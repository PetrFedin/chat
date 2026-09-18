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
- optional audio-only transcription sidecar для длинных встреч, при этом MP4 остаётся review/evidence archive;
- provider-attempt telemetry: provider/model, attempt, request usage, latency и failure state без фиксации меняющейся цены в source event;
- Web Push infrastructure при настроенных VAPID-ключах;
- задачи и календарные события через тот же API;
- installable mobile-first PWA, RU/EN и dark/light themes.

## Запуск

```bash
npm install
npm start
```

Откройте `http://localhost:3000` и зарегистрируйте компанию.

Без `DATABASE_URL` используется in-memory development store — данные сбрасываются после рестарта. Для постоянного многопользовательского режима примените миграции `001`–`011` по порядку и задайте:

```bash
DATABASE_URL=postgres://...
```

### Demo и persistence

Demo включается только явно:

```bash
DEMO_MODE=true
```

В memory-режиме Northstar Studio пересоздаётся после каждого рестарта. При одновременно заданных `DEMO_MODE=true` и `DATABASE_URL` тот же demo tenant хранится в PostgreSQL, повторный startup использует существующий workspace и не должен дублировать сотрудников, задачи, календарь или synthetic Meeting Intelligence.

Встроенные demo-файлы имеют fixture catalog: если PostgreSQL сохранился, а локальный ephemeral filesystem был очищен, эти демонстрационные SVG/Markdown/CSV могут быть восстановлены в прежние storage keys. Это **не** делает локальное файловое хранилище production-durable: обычные пользовательские загрузки и реальные записи встреч требуют S3-compatible storage.

`GET /healthz` отдельно показывает durability database и object storage. `persistence.productionReady=true` только когда authoritative database — PostgreSQL и object storage объявлен durable.

## Реальные аудио/видеозвонки

Без LiveKit приложение продолжает работать, но `/join` честно отвечает `MEDIA_PROVIDER_UNAVAILABLE`. Для настоящих звонков настройте LiveKit Cloud или self-hosted LiveKit:

```bash
LIVEKIT_URL=wss://your-livekit-host
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
```

Browser получает только short-lived participant token. `LIVEKIT_API_SECRET` никогда не отправляется клиенту. TURN/SFU transport обслуживается настроенной LiveKit-инфраструктурой.

## S3-compatible storage и запись встреч

Если `S3_BUCKET` не задан, обычные файлы сохраняются локально в `data/uploads` или `UPLOAD_DIR`. Такое хранилище считается недолговечным для production и на ephemeral hosting может быть очищено при redeploy/restart. Если `S3_BUCKET` задан — файловый adapter автоматически переключается на durable S3-compatible storage:

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

По умолчанию LiveKit Egress сохраняет один composite MP4 в тот же S3-compatible контур. Он остаётся архивом встречи и источником доказательства.

Для более лёгкого speech-to-text источника можно **явно** включить параллельный audio-only OGG sidecar:

```bash
LIVEKIT_TRANSCRIPTION_EGRESS_ENABLED=true
```

Это отдельный Egress и поэтому не включается скрыто. При включении Chat хранит два связанных provider recording ID: MP4 archive и OGG transcription source. Если OGG готов — транскрипция предпочитает его. Если sidecar завершился ошибкой, но MP4 готов, pipeline детерминированно возвращается к MP4. Если MP4 упал, но OGG готов, транскрипция может продолжиться, при этом архив встречи честно остаётся в состоянии `failed`.

`egress_ended` принимается только через подписанный LiveKit webhook. Job создаётся один раз при появлении первого пригодного transcription source.

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

## Processing safety и экономика

Текущий provider adapter принимает media bytes как multipart body, поэтому Chat вводит собственный fail-safe до загрузки крупного объекта в память:

```bash
MEETING_PROCESSING_MAX_IN_MEMORY_BYTES=67108864
```

Default — 64 MiB. Object storage сначала проверяется через `head()`. Если выбранный archive/sidecar превышает лимит, job завершается контролируемой ошибкой `RECORDING_OBJECT_TOO_LARGE`; provider не вызывается и приложение не пытается неограниченно аллоцировать RAM. Для длинных встреч предпочтителен audio-only sidecar.

Каждый фактический внешний provider attempt записывается отдельно в `meeting_provider_calls`: `provider`, `model`, `attempt_number`, provider request ID, source metadata, provider-reported `usage`, latency и failure state. Повторная попытка не перезаписывает предыдущую.

Денежная стоимость намеренно не зашивается в историческую provider-call запись: тарифы меняются. Экономика должна рассчитываться из сохранённого usage через версионированный price catalog, чтобы историческая себестоимость была воспроизводимой.

Пользовательский Meeting Center получает безопасные операционные метрики, но не provider request IDs и не внутренние source metadata.

`GET /healthz` показывает webhook, processor и worker state, а также отдельный `persistence` блок: durability базы, durability object storage и итоговый `productionReady`.

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
- запись валидируется в object storage до transcription, а SHA-256 фактически выбранного source сохраняется в intelligence run;
- AI proposals не являются authoritative work: responsibility, promised date и создание task подтверждаются человеком;
- Chat/PostgreSQL остаётся authoritative для lifecycle и work graph; LiveKit отвечает за media transport/Egress, AI provider — только за предложенную интерпретацию доказательств.

См. `docs/ARCHITECTURE.md`, `docs/PRODUCT_BLUEPRINT.md`, `docs/MULTIUSER_RUNTIME.md`, `docs/REALTIME_MEDIA.md` и `docs/MEETING_INTELLIGENCE.md`.
