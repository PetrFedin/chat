# CHATX — конкурентная матрица и следующий рубеж архитектуры

Дата: 2026-10-20. Основа: PR #61 и исправление интерфейса в PR #62. Статус: исследование и требования; не заявление о готовности функций к production.

## 1. Подход к проверке

Под конкурентной функцией понимается проверяемый сценарий, а не рекламная надпись. Свойства конкурентов изучены по официальным публичным руководствам, а не путём сквозных тестов их коммерческих аккаунтов. Для CHATX статус определяется содержимым интеграционной ветки и результатами CI. Код в Draft PR не равен внедрённой функции. Нельзя утверждать, что предложенная идея отсутствует во всех мировых решениях без соответствующего исследования.

Исходная интеграция PR #61: bfa458aaa4d41c55ba86e304ed0170efb22c355f. Run #584: 1382 PASS, 4 FAIL, 0 SKIP из 1386 PostgreSQL и browser tests; четыре браузерных теста Pages timeout на access, recovery, meeting linking и history restore. В PR #62 исправлен отсутствующий блок интерфейса Pages; новый тестовый статус CI #585 проверяется отдельно. До полного GREEN и независимого ревью production остаётся HOLD.

## 2. Аналоги на российском рынке

| Продукт | Документированное преимущество / функция | Соответствующее основание CHATX | Приоритет следующего развития |
| --- | --- | --- | --- |
| Битрикс24 | Задачи и поток работы, Гант, канбан, коммуникации | Task Authority, чаты, проекты | Единая карточка задачи: сообщение-источник, решение, дата, evidence, reviewer |
| Яндекс Трекер | Базовые планы диаграммы Ганта и сравнение текущих сроков | Gantt/зависимости и read-only What-if в Draft | Immutable baseline + plan vs actual и объяснимые причины изменений |
| Planfix | Сценарии автоматизации, кнопки и повторяемые шаблоны | Requests, Task, Webhooks | No-code automation rules с dry-run, аудитом, idempotency и ограниченными действиями |
| Pyrus | Последовательные/параллельные, условные и BPMN согласования | Requests и approval chain | Версионируемые маршруты, ролевая очередь, правило повторного согласования при изменении |
| Kaiten | Cycle time, throughput, blocked time, flow analytics | Dashboard/Task report | Потоковая аналитика по audit event с прозрачными знаменателями |
| YouGile | Чат вокруг каждой задачи, права на уровнях, планирование связей | Канонические Tasks + диалоги + проекты | Контекстный чат задачи с обратной ссылкой без копирования состояния |
| TEAMLY | RAG по базе знаний с учётом доступа и документами | Wiki/Pages, Knowledge, локальный поиск и chat assistant | Ссылки на источники и ACL-safe вопросы по проверенным корпоративным данным |
| Weeek | Портфели, CRM, кастомные поля, импорты, Gantt, календарь | Projects/Tasks/Calendar/Pages | Настраиваемые представления и импорт с preview; CRM только при обоснованном спросе |

Официальные источники:
- https://www.bitrix24.ru/features/tasks/flow/
- https://yandex.ru/support/tracker/ru/gantt/project
- https://planfix.ru/feature/automation/
- https://pyrus.com/ru/help/workflow/editor
- https://pyrus.com/ru/help/workflow/bpmn
- https://kaiten.ru/features/reports/
- https://ru.yougile.com/product
- https://teamly.ru/ai/
- https://weeek.net/ru/features

## 3. Аналоги на международном рынке

| Продукт | Документированная функция | Основа CHATX | Что развивать |
| --- | --- | --- | --- |
| ClickUp | Whiteboards, интерактивные dashboards, задачи, документы и чаты | Чаты, Pages, Tasks, Projects, Dashboard | Interactive Executive Cockpit и linked whiteboard на канонических сущностях |
| Asana AI Studio | AI-powered intake, классификация, маршрутизация, SLA, approvals | Meeting Intelligence, human confirmation, Requests | AI Rules с dry-run, подтверждением человеком, бюджетом и audit |
| Notion Enterprise Search | Поиск по workspace и внешним приложениям, ответы с цитатами | Permission-filtered local search | Federated search с внешним ACL и проверяемыми ссылками на источник |
| Jira | Конфигурируемые workflow статусы и transitions | Task state-machine | Типизированные workflow policies без потери доказательств приёмки |
| Linear | Initiatives, Projects, Cycles, Issues, analytics, requests | Projects, Tasks, Decisions, Requests | Portfolio initiatives и единый менеджерский обзор исполнения |
| Slack | Channels, Canvas, Lists, Huddles, workflows | Channels, Pages, Tasks, Calls | Переход из сообщения к действию с сохранением provenance |

Официальные источники:
- https://clickup.com/features/whiteboards
- https://clickup.com/features/dashboards
- https://asana.com/product/ai/ai-studio
- https://www.notion.com/help/enterprise-search
- https://www.atlassian.com/software/jira/features/workflows
- https://linear.app/features
- https://slack.com/features

Правило: не копировать чужой код/дизайн или лицензируемые активы. Берём проверяемые продуктовые требования и строим собственную реализацию.

## 4. Базовая уникальная концепция: Decision Execution

Рабочая цепь: Совещание / запись / протокол → подтверждённое решение → канонические Task links → Project plan и dependencies → выполненные действия → доказательства → review и принятие → управленческая отчётность.

Канонические владельцы:
- Decision Authority — содержание, дата и состояние решения.
- Task Authority — исполнитель, сроки, статусы, вложенные evidence, reviewer и приёмка.
- Project Authority — фазы, Гант, зависимости и базовые планы; не дублирует состояние задачи.
- Pages Authority — документ/история/ACL; ссылки на другие объекты не расширяют доступ.
- Meeting Authority — участники, запись и расшифровка; страница не копирует приватный текст.

Новый Decision Execution Cockpit (требование, пока не объявлять реализованным):
1. Реестр принятых решений с фильтрами по встрече, проекту, ответственному, дате, угрозе срыва и признаку отсутствия задач.
2. Карточка решения: основание, связанные доступные Task, связанные Pages/Projects, прогресс и причины блокировки.
3. Canonical Task deep link; create-task отдельным подтверждаемым действием с аудитом.
4. Статус верификации рассчитывается из Task lifecycle, не сохраняется в отдельной конкурирующей таблице. Без полного scope решения нельзя объявить его автоматически выполненным.
5. Статистика: принятые без исполнителя, срок нарушения, количество просроченных задач, verified completion; каждая метрика показывает формулу, исходные события, фильтры и время вычисления.
6. Роли и запрет боковых утечек: если пользователь не имеет права видеть Task, нельзя раскрывать её ID, название, комментарии, count hidden, содержимое вложения или private Call transcript.

Опциональная метрика Verified Decision Completion: количество решений, все обязательные видимые задачи которых прошли именно приемку результата / количество решений с явно определённым scope. Решение без scope — not_assessable, не 100%. Это *проектная формула*, не существующий пользовательский KPI.

## 5. Функциональные контракты следующего этапа

**A. Approval policy:** версия согласовываемой записи, состав согласующих, последовательные и параллельные ветви; изменение суммы, сроков, состава работ или обязательных требований после подтверждения создаёт новую редакцию и требует новой визы по правилам. Изменение никогда не становится молча действующим.

**B. Gantt baseline:** снимок плановых дат и dependencies, immutable после подтверждения. Read-only What-if остаётся предварительным расчётом; вносящий фактическое изменение явно подтверждает последствия.

**C. Execution Analytics:** cycle time, throughput, blockers, aging/WIP, оценка загрузки и источники отклонений из реальных событий, периодов и идентификаторов. Без искусственного улучшения процента выполненных задач.

**D. Rules/AI:** рабочие сценарии сначала только read/preview, затем policy-gated mutating actions; идемпотентность, ограничение стоимости, логируемые версии правил, отмена/компенсация и человеческое подтверждение рискованных переходов.

**E. Knowledge:** ссылочный ответ с цитированием видимых пользователю документов и точных версий. Если проверяемого доказательства нет, система сообщает об отсутствии ответа. Prompt injection из внешнего документа не изменяет права доступа.

**F. Whiteboard и Import:** доска — проекция канонических объектов, не новый Task Store. Импорт с staging, схемой сопоставления ID, проверкой прав, дедупликацией и явным commit.

## 6. Приоритеты и приёмка

| Код | Приоритет | Результат | Admission test |
| --- | --- | --- | --- |
| CX-01 | P0 | PR #62 Pages UI возвращён | 4 исходных browser-failure PASS на exact SHA, остальные DB/domain/JS тесты 0 FAIL |
| CX-02 | P0 | Совместимость ACL связей | Matrix: 5 ролей × свой/чужой workspace × Wiki/Projects/Decisions/Tasks feature OFF/ON |
| CX-03 | P0 | Безопасный upgrade | 085→089 на fresh и upgraded DB, rollback drill, изменение доступа не меняет контент |
| CX-04 | P1 | Decision Execution read-only cockpit | Только разрешённые Task/Decision/Page/Meeting проекции, точный подсчёт статусов |
| CX-05 | P1 | Portfolio health/analytics | Объяснимые числитель/знаменатель, drill-down на источники, фильтры и периоды |
| CX-06 | P1 | Baselines | История immutable планов; plan/actual без скрытого пересчёта задач |
| CX-07 | P1 | Workflow V1 | Sequential/parallel/conditional routing + audit + policy version + regression |
| CX-08 | P1 | Grounded enterprise answers | Лицензированное/согласованное подключение источников, no-permission = no-answer |
| CX-09 | P2 | Whiteboard + migration | Стабильные ссылки и безопасное восстановление после частичного импорта |
| CX-10 | P2 | Enterprise scope | SSO/SCIM/retention/legal hold/data residency после юридического и security review |

Обязательные отрицательные проверки:
- Page→Task link не даёт доступ к Task при отсутствии полномочий.
- Page→Call unlink не удаляет запись, приватный transcript или участников.
- Restore Page не меняет ACL, owner, grants, hierarchy, links и canonical entities.
- Decision→Task unlink не меняет Task lifecycle и evidence.
- Деактивация функции скрывает projections, но не стирает ссылочные таблицы.
- Отзыв прав между чтением и записью вызывает отказ в самом write transaction.
- Дублирующий запрос не создаёт дубли; версия stale edit возвращает корректный конфликт.
- Личность владельца и скрытые ID не утекают в search, activity, counts или notifications.

## 7. Полная release qualification

1. Точный commit SHA, история PR, независимый code/security review.
2. Unit/domain, PostgreSQL 17 full suite, migrations, cross-role/tenant negative, browser tests одновременно зелёные на финальной интеграции.
3. 375/390/768/1440 px: мобильные и десктопные сценарии, доступность, keyboard, контраст и ошибки пустых данных.
4. Backup/restore, повторная миграция, критические гонки, потеря сети, timeout и idempotency.
5. Рекламные материалы — только реальная запущенная сборка с синтетическими явно подписанными демоданными: PNG, MP4 20–30 секунд, SHA-256 manifest, дата, снимок версии, no secrets.
6. Не публиковать непроверенную версию, не создавать платные сервисы и не заявлять сертификации или проценты ускорения без доказательств.

**Порядок:** сначала закрыть CI #585 и независимое ревью Pages UI; далее Decision Execution read-only; затем user-controlled actions; потом Workflow/Analytics/AI; лишь после допуска — полноценные investor-ready материалы.
