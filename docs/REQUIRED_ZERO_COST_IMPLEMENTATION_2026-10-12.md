# chat — обязательная программа внедрения с нулевой стоимостью

**Snapshot:** 2026-10-12 · **Status:** REQUIRED / NOT ALL IMPLEMENTED · **Purpose:** persistent work pickup, not release evidence.

**Источник канона:** `README.md`, PR #21 multi-role tenant test, PR #22 audited completion plan

**Текущее ограничение:** PR #21 и #22 остаются Draft. Не считать документированный функционал внедрённым без серверного и browser evidence.

## Работы в порядке зависимости

| ID | Priority | Обязательно внедрить | Связи/зависимости | Доказательство завершения |
|---|---|---|---|---|
| CHX-ZC-01 | P0 | Закрыть PR #21: multi-role isolation | owner/admin/manager/employee/reviewer/guest → API → PostgreSQL → realtime | CI GREEN exact SHA, нет existence/metadata leakage, negative tenant/role E2E |
| CHX-ZC-02 | P0 | CHATX-INT-04: полноценный Pages Editor | Tiptap → persistence → rendered view → version/concurrent edit handling | headings/lists/links/undo/save, conflict/reload/ACL tests, mobile E2E |
| CHX-ZC-03 | P1 | Соединить рабочий граф без дублирования | Page ↔ Task/Meeting/Channel → Decision Register → permission-aware Search | bidirectional links, фильтрация по правам и сохранение связи после рестарта |
| CHX-ZC-04 | P1 | Проверить production resilience и внешние каналы | PG restore → files → meeting consent → webhook → jobs/outbox | negative tenant cases, backup/restore drill, reconnect, no secret leaks |

## Непереговорные ограничения: 0 ₽ новых расходов
- Запрещено создавать/включать платные ресурсы, pay-as-you-go, автоапгрейд, платный AI/API, платную БД, облачное хранилище, CI minutes сверх бесплатной квоты или оплачиваемые production-транзакции.
- Сначала доказывать, что существующая локальная инфраструктура, open-source инструменты или **подтверждённый доступный** бесплатный лимит действительно не требуют оплаты. Если 0-cost ресурс не подтверждён — статус `BLOCKED_NO_FREE_CAPACITY`, не выдумывать альтернативную готовность.
- Не менять и не подключать базу, секреты, деплой другого продукта; никогда не публиковать DSN/токены. Никаких несанкционированных изменений production/main. Кодовые задачи — отдельные PR и существующие quality gates.
- Не запускать реальные платежи/торговлю/рассылки/платные провайдеры ради теста: тесты, моки, sandbox без биллинга или проверенная бесплатная среда.

## Правило для исполнителя / агента
1. Сверить **текущие** main/PR/issues/CI с источниками выше: статусы здесь — snapshot на 2026-10-12, не подтверждение release.
2. Работать по очереди P0 → P1 → P2, но сначала разблокировать зависимости; не начинать следующую бизнес-цепочку, если предыдущая не доказана.
3. Для каждого пункта в PR приложить: exact SHA, файлы, миграции/API/UI связи, локальные тесты, негативные проверки прав, browser/device screenshots (если UI), DB/backup proof (если persistence), live verification (если публичный сервис), стоимость **0 ₽** с источником/лимитом.
4. Отмечать отдельно `PLANNED`, `IN_CODE`, `CI_PASS`, `LIVE_VERIFIED`, `BLOCKED`. Никогда не отмечать `DONE` только из-за документации или зелёного unit-test.
5. Сверить с существующими canonical specs/AGENTS.md; этот чеклист добавляет приоритеты и cost gate, но не заменяет доменную архитектуру/политику.

## Передача следующему проходу
- Выбирай **первый незакрытый незаблокированный** пункт P0, проверяй реальное состояние и открывай точечную реализацию, а не создавай ещё один «план без кода».
- После каждого рабочего прохода обновляй issue/PR и данный чеклист с ссылками на evidence, но не перезаписывай наблюдения устаревшим snapshot.
