/* Email is a source inside Messages. Every durable change goes through the
 * authenticated email API; this module never promotes a contact to a member,
 * turns an external promise into a Task, or infers delivery from a network ACK. */
const E = {
  host: null, bridge: {}, sessionKey: null, boot: null, bootAt: 0,
  items: [], draftItems: [], queue: [], activeIntentId: null, nextCursor: null, detail: null, selected: null,
  mailboxId: '', folder: 'inbox', query: '', peopleView: false,
  loading: false, listLoading: false, detailLoading: false, error: '',
  generation: 0, request: 0, detailRequest: 0, mounted: false,
  compose: null, composers: new Map(), intents: new Map(),
  sheet: null, sheetDispose: null, sheetOpener: null, sheetKind: null,
  saveTimer: null, sendTimer: null, preferences: null,
};

const ROOT = '/api/v1/email';
const tr = (ru, en) => window.ChatPreferences?.locale === 'en' ? en : ru;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const idPath = value => encodeURIComponent(String(value));
const key = () => crypto.randomUUID?.() ?? `email-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const userId = () => E.bridge.user?.userId ?? E.bridge.user?.id;
const offline = () => navigator.onLine === false;
const own = (object, name) => Object.prototype.hasOwnProperty.call(object ?? {}, name);
const arr = value => Array.isArray(value) ? value : [];
const people = () => arr(E.bridge.people).filter(p => p.active !== false && p.role !== 'guest');
const personName = id => people().find(p => p.id === id || p.userId === id)?.displayName ?? people().find(p => p.id === id || p.userId === id)?.name ?? id ?? '';
const mailbox = id => arr(E.boot?.mailboxes).find(box => box.id === (id || E.mailboxId || E.detail?.thread?.mailboxId));
const cap = name => E.boot?.capabilities?.[name] === true;
const safeDate = value => {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? date : null;
};
const dateText = value => safeDate(value)?.toLocaleString(window.ChatPreferences?.locale === 'en' ? 'en-GB' : 'ru-RU', {dateStyle:'medium', timeStyle:'short'}) ?? '—';
const datetimeValue = value => {
  const date = safeDate(value);
  return date ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
};
const address = item => typeof item === 'string' ? {address:item, name:''} : {address:item?.address ?? item?.email ?? '', name:item?.name ?? item?.displayName ?? ''};
const displayAddress = item => {
  const p = address(item);
  if (!p.name) return p.address;
  const name = /[",;<>\\]/.test(p.name) ? '"' + p.name.replace(/[\\"]/g,'\\$&') + '"' : p.name;
  return name + ' <' + p.address + '>';
};
const addressList = items => arr(items).map(displayAddress).filter(Boolean).join(', ');
const outgoing = message => ['outgoing','outbound'].includes(message?.direction);
const badge = (text, kind = '') => `<span class="cx-email-badge ${kind ? `is-${kind}` : ''}">${esc(text)}</span>`;
const button = (action, label, extra = '', kind = '') => `<button type="button" class="cx-email-button ${kind}" data-email-action="${action}" ${extra}>${esc(label)}</button>`;
const disabled = value => value ? 'disabled' : '';

function connectionLabel(state) {
  return ({connected:tr('Подключён','Connected'), syncing:tr('Синхронизация','Synchronising'),
    connecting:tr('Проверка подключения','Checking connection'), pending:tr('Ожидает подключения','Connection pending'),
    requires_auth:tr('Нужно войти снова','Sign in again'), reauth_required:tr('Нужно войти снова','Sign in again'),
    paused:tr('Синхронизация приостановлена','Synchronisation paused'), disconnected:tr('Не подключён','Not connected'),
    failed:tr('Ошибка подключения','Connection failed'), error:tr('Ошибка подключения','Connection failed'),
    imported:tr('Импортированные письма','Imported email'), manual:tr('Ручной импорт','Manual import'), local:tr('Локальный архив · без отправки','Local archive · no sending'),
    demo:tr('Демонстрационные данные','Demo data'), unavailable:tr('Провайдер недоступен','Provider unavailable'),
  })[state] ?? tr('Подключение не подтверждено','Connection not confirmed');
}

function sendLabel(state) {
  return ({queued:tr('В очереди','Queued'), scheduled:tr('Запланировано','Scheduled'),
    dispatching:tr('Передаётся провайдеру','Handing off to provider'),
    provider_accepted:tr('Принято почтовым провайдером','Accepted by mail provider'),
    unknown_outcome:tr('Результат отправки неизвестен','Send outcome unknown'),
    failed:tr('Не отправлено','Send failed'), cancelled:tr('Отменено','Cancelled'),
    needs_approval:tr('Ожидает одобрения','Awaiting approval'), approved:tr('Одобрено','Approved'),
  })[state] ?? tr('Проверяем отправку','Checking send status');
}

function sentCopyLabel(state) {
  return ({saved:tr('Копия сохранена в папке отправленных','A copy was saved in Sent'),
    already_present:tr('Копия найдена в папке отправленных','A copy was found in Sent'),
    provider_pending:tr('Провайдер ещё не подтвердил копию в отправленных','The provider has not confirmed the Sent copy yet'),
    unavailable:tr('Папка отправленных недоступна','The Sent folder is unavailable'),
    unknown:tr('Сохранение копии в отправленных не подтверждено','Saving a copy in Sent is not confirmed'),
  })[state] ?? tr('Состояние копии в отправленных уточняется','The Sent copy status is being checked');
}

function mailboxSyncStatus(box) {
  return `${box.lastSyncedAt ? `<p class="cx-email-caption">${tr('Последняя синхронизация','Last sync')}: ${esc(dateText(box.lastSyncedAt))}</p>` : ''}
    ${box.historyLimited || box.hasMore ? `<p class="cx-email-notice">${box.historyLimited ? tr('История ещё загружена не полностью. Более ранние письма поступят при следующих синхронизациях.','History is still incomplete. Earlier email will arrive in subsequent synchronisations.') : tr('Остались изменения, которые поступят при следующей синхронизации.','More changes will arrive in the next synchronisation.')}</p>` : ''}
    ${box.lastSyncError ? `<p class="cx-email-error">${tr('Последняя синхронизация не завершилась','Last synchronisation did not complete')}: ${esc(typeof box.lastSyncError === 'string' ? box.lastSyncError : box.lastSyncError.message || box.lastSyncError.code)}</p>` : ''}`;
}

function sourceLabel(source) {
  return source === 'demo' ? tr('Демо','Demo') : source === 'manual_import' ? tr('Ручной импорт','Manual import') : tr('Почта','Email');
}

function allowed(action, fallback = false) {
  const actions = E.detail?.thread?.allowedActions;
  if (Array.isArray(actions)) return actions.includes(action);
  const named = ({read:'canRead',reply:'canReply',note:'canNote',assign:'canAssign',archive:'canReply',snooze:'canReply',manage:'canManage'})[action];
  if (actions && typeof actions === 'object') {
    if (own(actions, action)) return actions[action] === true;
    if (named && own(actions,named)) return actions[named] === true;
  }
  return fallback;
}

async function api(path, options = {}) {
  if (!E.bridge.api) throw new Error(tr('Почтовый модуль ещё загружается. Откройте «Почта» снова.','Email is still loading. Open Email again.'));
  const body = options.body;
  const identity = E.sessionKey;
  const result = await E.bridge.api(path.startsWith('/api/') ? path : `${ROOT}${path}`, {
    ...options,
    ...(body !== undefined && !(body instanceof FormData) && typeof body !== 'string' ? {body:JSON.stringify(body)} : {}),
  });
  if (identity !== E.sessionKey) { const error = new Error(tr('Сессия изменилась.','The session changed.')); error.code = 'EMAIL_SESSION_CHANGED'; throw error; }
  return result;
}

function report(error) {
  if (error?.code === 'EMAIL_SESSION_CHANGED') return '';
  const message = error?.message || tr('Не удалось выполнить действие. Повторите попытку.','The action could not be completed. Try again.');
  E.bridge.toast?.(message);
  return message;
}

function configure(bridge = {}) {
  const identity = [bridge.user?.organizationId, bridge.user?.workspaceId, bridge.user?.userId ?? bridge.user?.id].filter(Boolean).join(':');
  if (E.sessionKey && identity && E.sessionKey !== identity) reset();
  E.bridge = {...E.bridge, ...bridge};
  if (identity) { E.sessionKey = identity; if (!E.recoveryLoaded) loadRecovery(); }
}

function captureComposer() {
  const form = E.host?.querySelector('[data-email-compose-form]');
  if (!form || !E.compose || form.dataset.emailComposeKey !== `${E.compose.localKey}:${E.compose.mode}`) return;
  for (const name of ['to','cc','bcc','subject','text','fromAddress','mailboxId']) {
    const field = form.elements.namedItem(name);
    if (field) E.compose[name] = field.value;
  }
  E.composers.set(E.compose.localKey, E.compose);
}

function unmount() {
  captureComposer();
  E.mounted = false;
  E.generation += 1;
  if (E.host) {
    E.host.removeEventListener('click', onClick);
    E.host.removeEventListener('input', onInput);
    E.host.removeEventListener('change', onChange);
    E.host.removeEventListener('submit', onSubmit);
  }
  E.host = null;
  clearTimeout(E.sendTimer);
}

function reset() {
  unmount();
  closeSheet('reset');
  clearRecovery(true);
  clearTimeout(E.saveTimer);
  E.sessionKey = null; E.boot = null; E.bootAt = 0; E.bridge = {};
  E.items = []; E.draftItems = []; E.queue = []; E.activeIntentId = null; E.nextCursor = null; E.detail = null; E.selected = null;
  E.mailboxId = ''; E.folder = 'inbox'; E.query = ''; E.peopleView = false;
  E.compose = null; E.composers.clear(); E.intents.clear(); E.preferences = null;
  E.error = ''; E.loading = false; E.listLoading = false; E.detailLoading = false;
  E.request += 1; E.detailRequest += 1;
  E.recoverable = []; E.recoveryLoaded = false;
}

async function mount(host, bridge = {}) {
  if (!(host instanceof Element)) return;
  configure(bridge);
  if (E.host !== host) unmount();
  E.host = host; E.mounted = true;
  host.classList.add('cx-email'); host.setAttribute('data-prefs-owned', '');
  host.addEventListener('click', onClick);
  host.addEventListener('input', onInput);
  host.addEventListener('change', onChange);
  host.addEventListener('submit', onSubmit);
  render();
  if (!E.boot || Date.now() - E.bootAt > 30000) await refresh();
  else if (!E.items.length && !E.listLoading) await loadThreads();
  pollIntents();
}

async function refresh() {
  const generation = E.generation;
  E.loading = !E.boot; E.error = ''; render();
  try {
    const boot = await api('/bootstrap');
    if (generation !== E.generation) return;
    E.boot = boot; E.bootAt = Date.now(); E.preferences = boot.preferences ?? E.preferences;
    if (E.mailboxId && !arr(boot.mailboxes).some(box => box.id === E.mailboxId)) E.mailboxId = '';
    E.loading = false; render();
    await loadThreads();
    if (E.selected) await loadThread(E.selected, {keepComposer:true});
  } catch (error) {
    if (generation !== E.generation) return;
    E.loading = false; E.error = error?.message ?? tr('Почта недоступна','Email is unavailable'); render();
  }
}

async function loadThreads({append = false} = {}) {
  if (!E.boot || !arr(E.boot.mailboxes).length) { E.items = []; render(); return; }
  const request = ++E.request;
  E.listLoading = true; E.error = ''; render();
  const params = new URLSearchParams({folder:E.folder, limit:'40'});
  if (E.mailboxId) params.set('mailboxId', E.mailboxId);
  if (E.query.trim()) params.set('q', E.query.trim());
  if (append && E.nextCursor) params.set('cursor', E.nextCursor);
  try {
    if (E.folder === 'drafts' || E.folder === 'outbox') {
      const query = E.mailboxId ? `?mailboxId=${idPath(E.mailboxId)}` : '';
      const result = await api(`${E.folder === 'drafts' ? '/drafts' : '/send-intents'}${query}`);
      if (request !== E.request) return;
      if (E.folder === 'drafts') E.draftItems = arr(result.items);
      else { E.queue = arr(result.items); for (const intent of E.queue) E.intents.set(intent.id,intent); }
      E.nextCursor = null; return;
    }
    const result = await api(`/threads?${params}`);
    if (request !== E.request) return;
    const next = arr(result.items);
    E.items = append ? [...new Map([...E.items, ...next].map(item => [item.id, item])).values()] : next;
    E.nextCursor = result.nextCursor ?? null;
  } catch (error) { if (request === E.request) E.error = error.message; }
  finally { if (request === E.request) { E.listLoading = false; render(); } }
}

async function openThread(id, options = {}) {
  if (!id) return;
  captureComposer();
  E.activeIntentId = null;
  E.selected = id;
  E.compose = E.composers.get(`thread:${id}`) ?? null;
  if (options.messageId) E.focusMessage = options.messageId;
  const hash = `#/chats/email/${idPath(id)}`;
  if (location.hash !== hash) { try { history.pushState(null,'',hash); } catch {} }
  return loadThread(id);
}

async function openQueue({intentId = null, mailboxId = ''} = {}) {
  captureComposer(); closeSheet();
  E.folder = 'outbox'; E.mailboxId = mailboxId; E.query = '';
  E.selected = null; E.detail = null; E.compose = null; E.activeIntentId = null;
  if (!E.boot) await refresh(); else await loadThreads();
  if (intentId) {
    try {
      const result = await api(`/send-intents/${idPath(intentId)}`);
      E.intents.set(result.sendIntent.id,result.sendIntent); E.activeIntentId = result.sendIntent.id;
    } catch (error) { report(error); }
  }
  render();
}

async function loadThread(id, {keepComposer = false} = {}) {
  const request = ++E.detailRequest;
  E.detailLoading = true; E.detailError = ''; render();
  try {
    const result = await api(`/threads/${idPath(id)}`);
    if (request !== E.detailRequest || E.selected !== id) return;
    E.detail = result;
    if (!keepComposer && !E.compose && arr(result.drafts).length) {
      const candidate = arr(result.drafts).find(d => !d.authorId || d.authorId === userId()) ?? arr(result.drafts).find(d => d.shared) ?? null;
      if (candidate) E.compose = composeFromDraft(candidate);
    }
    for (const intent of arr(result.sendIntents)) E.intents.set(intent.id, intent);
    const queued = await api(`/send-intents?mailboxId=${idPath(result.thread.mailboxId)}`);
    if (request !== E.detailRequest || E.selected !== id) return;
    for (const intent of arr(queued.items)) E.intents.set(intent.id,intent);
    const index = E.items.findIndex(item => item.id === id);
    if (index >= 0) E.items[index] = {...E.items[index], ...result.thread};
  } catch (error) {
    if (request === E.detailRequest) {
      E.detailError = error.message;
      if (error.status === 403 || error.status === 404) { E.detail = null; E.compose = null; E.composers.delete(`thread:${id}`); }
    }
  } finally {
    if (request === E.detailRequest) {
      E.detailLoading = false; render();
      if (E.focusMessage) {
        E.host?.querySelector(`[data-email-message="${CSS.escape(E.focusMessage)}"]`)?.scrollIntoView({block:'nearest'});
        E.focusMessage = null;
      }
    }
  }
}

function render() {
  if (!E.host || !E.mounted) return;
  // Input events update composer state immediately. Reading the previous DOM
  // here would overwrite a restored draft or a newly inserted template.
  const focus = E.host.contains(document.activeElement) ? document.activeElement?.getAttribute('data-email-field') : null;
  const selection = focus && typeof document.activeElement.selectionStart === 'number' ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
  const scroll = E.host.querySelector('.cx-email-message-list')?.scrollTop;
  E.host.innerHTML = `<div class="cx-email-workspace ${E.selected || E.compose || E.activeIntentId ? 'has-selection' : ''} ${E.compose ? 'has-composer' : ''}" data-email-workspace>
    ${renderSidebar()}<section class="cx-email-list-pane" aria-label="${esc(tr('Цепочки писем','Email threads'))}">${renderList()}</section>
    <section class="cx-email-reader" aria-label="${esc(tr('Содержимое переписки','Conversation content'))}">${renderReader()}</section>
  </div>`;
  if (scroll !== undefined) { const list = E.host.querySelector('.cx-email-message-list'); if (list) list.scrollTop = scroll; }
  if (focus) {
    const field = E.host.querySelector(`[data-email-field="${CSS.escape(focus)}"]`);
    field?.focus({preventScroll:true});
    if (selection && field?.setSelectionRange) { try { field.setSelectionRange(...selection); } catch {} }
  }
}

function renderSidebar() {
  const summary = E.boot?.summary ?? {};
  const folders = [['inbox',tr('Входящие','Inbox')],['unread',tr('Непрочитанное','Unread')],
    ['waiting',tr('Ждём ответ','Waiting for a reply')],['drafts',tr('Черновики','Drafts')],
    ['outbox',tr('Очередь отправки','Outbox')],['sent',tr('Отправленные','Sent')],['snoozed',tr('Отложено','Snoozed')],
    ['archived',tr('Архив','Archive')],['all',tr('Все письма','All email')]];
  return `<aside class="cx-email-sidebar" aria-label="${esc(tr('Почтовые ящики и папки','Mailboxes and folders'))}">
    <div class="cx-email-sidebar-title"><strong>${tr('Почта','Email')}</strong>${button('settings',tr('Настройки','Settings'),'','is-quiet')}</div>
    ${button('new',tr('Написать письмо','Compose email'),disabled(!arr(E.boot?.mailboxes).some(box => box.canReply !== false)), 'is-primary')}
    <label class="cx-email-field"><span>${tr('Ящик','Mailbox')}</span><select data-email-field="mailbox" data-email-mailbox aria-label="${esc(tr('Почтовый ящик','Mailbox'))}">
      <option value="">${tr('Все доступные ящики','All accessible mailboxes')}</option>
      ${arr(E.boot?.mailboxes).map(box => `<option value="${esc(box.id)}" ${box.id === E.mailboxId ? 'selected' : ''}>${esc(box.label || box.address)} · ${box.kind === 'shared' ? tr('общий','shared') : tr('личный','personal')}</option>`).join('')}
    </select></label>
    <nav class="cx-email-folders" aria-label="${esc(tr('Папки почты','Email folders'))}">${folders.map(([id, title]) => `<button type="button" data-email-folder="${id}" class="${E.folder === id ? 'is-active' : ''}" ${E.folder === id ? 'aria-current="page"' : ''}><span>${title}</span>${Number.isFinite(summary[id]) ? `<span class="cx-email-count">${summary[id]}</span>` : ''}</button>`).join('')}</nav>
    <div class="cx-email-sidebar-foot"><p>${tr('Непрочитанное — ваша отметка. Ожидания и задачи учитываются отдельно.','Unread is your own marker. Waiting items and Tasks are tracked separately.')}</p>
      ${button('import',tr('Импортировать .eml','Import .eml'),disabled(!cap('canImport')))}
      ${button('refresh',tr('Обновить','Refresh'),disabled(E.loading || E.listLoading))}
    </div>
  </aside>`;
}

function renderList() {
  const listHeading = E.folder === 'drafts' ? tr('Черновики','Drafts') : E.folder === 'outbox' ? tr('Очередь отправки','Outbox') : E.query ? tr('Результаты поиска','Search results') : tr('Переписка','Conversations');
  return `<div class="cx-email-list-toolbar"><div class="cx-email-section-heading"><h2>${listHeading}</h2>${button('settings',tr('Ящики','Mailboxes'),'','is-mobile-settings')}</div>
    <form class="cx-email-search" data-email-search><label class="cx-email-sr-only" for="cx-email-search">${tr('Поиск по почте','Search email')}</label><input id="cx-email-search" data-email-field="search" name="q" type="search" value="${esc(E.query)}" placeholder="${esc(tr('Поиск писем и адресов','Search email and addresses'))}"><button type="submit" class="cx-email-button">${tr('Найти','Search')}</button></form>
    ${!['drafts','outbox'].includes(E.folder) ? `<div class="cx-email-view-tabs"><button type="button" data-email-action="threads-view" aria-pressed="${!E.peopleView}">${tr('По темам','By topic')}</button><button type="button" data-email-action="people-view" aria-pressed="${E.peopleView}">${tr('Люди в выборке','People in this selection')}</button></div>` : ''}
    <div class="cx-email-mobile-tools">${button('new',tr('Написать','Compose'),disabled(!arr(E.boot?.mailboxes).length),'is-primary')}${button('filters',tr('Папки и ящики','Folders and mailboxes'))}${button('refresh',tr('Обновить','Refresh'))}</div>
    ${offline() ? `<p class="cx-email-notice" role="status">${tr('Нет сети. На экране сохранённая в этой вкладке копия.','Offline. You are viewing the copy kept in this tab.')}</p>` : ''}${renderRecovery()}
    ${E.boot?.capabilities?.mode === 'demo' || E.boot?.capabilities?.durable === false ? `<p class="cx-email-notice">${tr('Данные этого окружения временные.','Data in this environment is temporary.')}</p>` : ''}
  </div>
  ${E.error ? `<div class="cx-email-error" role="alert">${esc(E.error)}${button('refresh',tr('Повторить','Retry'))}</div>` : ''}
  ${E.loading ? `<div class="cx-email-empty" role="status">${tr('Загружаем почту…','Loading email…')}</div>` : !arr(E.boot?.mailboxes).length ? `<div class="cx-email-empty"><h3>${tr('Добавьте почтовый ящик','Add a mailbox')}</h3><p>${tr('Подключите доступного провайдера или импортируйте письмо. Статус подключения появится после проверки сервера.','Connect an available provider or import an email. Connection status appears after server verification.')}</p>${button('settings',tr('Добавить ящик','Add mailbox'),'','is-primary')}</div>` : E.folder === 'drafts' ? renderDraftList() : E.folder === 'outbox' ? renderQueueList() : E.peopleView ? renderPeople() : `<div class="cx-email-thread-list" aria-busy="${E.listLoading}">${E.items.map(renderThreadRow).join('') || `<div class="cx-email-empty"><h3>${E.query ? tr('Совпадений нет','No matches') : tr('Здесь пока нет писем','No email here yet')}</h3><p>${E.query ? tr('Измените запрос или выберите другой ящик.','Try another query or mailbox.') : tr('Выберите другую папку или обновите почту.','Choose another folder or refresh email.')}</p></div>`}</div>`}
  ${E.listLoading && E.boot ? `<p class="cx-email-loading" role="status">${tr('Обновляем список…','Updating the list…')}</p>` : ''}
  ${E.nextCursor ? `<div class="cx-email-load-more">${button('load-more',tr('Ещё письма','Load more email'),disabled(E.listLoading))}</div>` : ''}`;
}

function renderPeople() {
  const contacts = new Map();
  for (const thread of E.items) for (const item of arr(thread.participants)) {
    const p = address(item); if (!p.address) continue;
    const identity = p.address.trim().toLowerCase();
    const old = contacts.get(identity) ?? {...p, count:0}; old.count += 1; contacts.set(identity, old);
  }
  return `<div class="cx-email-people-list"><p class="cx-email-caption">${tr('Адреса из загруженной выборки. Совпадающие имена не объединяют людей.','Addresses from the loaded selection. Matching names do not merge people.')}</p>${[...contacts.values()].map(p => `<button type="button" class="cx-email-person" data-email-contact="${esc(p.address)}"><span class="cx-email-person-avatar" aria-hidden="true">${esc((p.name || p.address).slice(0,1).toUpperCase())}</span><span><strong>${esc(p.name || p.address)}</strong><small>${esc(p.address)}</small></span><span>${p.count}</span></button>`).join('') || `<p class="cx-email-empty">${tr('В этой выборке пока нет контактов.','No contacts in this selection yet.')}</p>`}</div>`;
}

function renderDraftList() {
  const query = E.query.trim().toLowerCase();
  const drafts = E.draftItems.filter(draft => !query || `${draft.subject} ${draft.text} ${addressList(draft.to)}`.toLowerCase().includes(query));
  return `<div class="cx-email-thread-list">${drafts.map(draft => `<button type="button" class="cx-email-thread ${E.compose?.id === draft.id ? 'is-selected' : ''}" data-email-draft="${esc(draft.id)}"><span class="cx-email-thread-top"><strong>${esc(draft.subject || tr('(без темы)','(no subject)'))}</strong><time>${esc(safeDate(draft.updatedAt)?.toLocaleDateString() || '')}</time></span><span class="cx-email-thread-preview">${esc(draft.text || '')}</span><span class="cx-email-thread-meta">${esc(addressList(draft.to) || tr('Получатели ещё не указаны','Recipients not selected yet'))}</span><span class="cx-email-badges">${badge(draft.shared ? tr('Общий черновик','Shared draft') : tr('Мой черновик','My draft'))}${draft.authorId !== userId() ? badge(personName(draft.authorId)) : ''}</span></button>`).join('') || `<p class="cx-email-empty">${tr('Сохранённых черновиков в этой выборке нет.','No saved drafts in this selection.')}</p>`}</div>`;
}

function renderQueueList() {
  const query = E.query.trim().toLowerCase();
  const items = E.queue.map(intent => E.intents.get(intent.id) || intent).filter(intent => !query || `${intent.subject || ''} ${addressList(intent.to)}`.toLowerCase().includes(query));
  return `<div class="cx-email-thread-list">${items.map(intent => `<button type="button" class="cx-email-thread ${E.activeIntentId === intent.id ? 'is-selected' : ''}" data-email-intent="${esc(intent.id)}"><span class="cx-email-thread-top"><strong>${esc(intent.subject || tr('Исходящее письмо','Outgoing email'))}</strong></span><span class="cx-email-thread-preview">${esc(addressList(intent.to))}</span><span class="cx-email-thread-meta">${esc(dateText(intent.scheduledAt || intent.createdAt))}</span><span class="cx-email-badges">${badge(intent.partial ? tr('Частичный приём','Partial acceptance') : sendLabel(intent.status || intent.state),intent.partial || ['unknown_outcome','failed'].includes(intent.status || intent.state) ? 'waiting' : '')}</span></button>`).join('') || `<p class="cx-email-empty">${tr('Попыток отправки пока нет.','No send attempts yet.')}</p>`}</div>`;
}

async function openDraft(id) {
  captureComposer(); E.activeIntentId = null;
  try {
    const result = await api(`/drafts/${idPath(id)}`);
    E.compose = composeFromDraft(result.draft); E.selected = result.draft.threadId || null;
    if (E.selected) await loadThread(E.selected,{keepComposer:true}); else { E.detail = null; render(); }
  } catch (error) { report(error); }
}

function renderThreadRow(thread) {
  const box = mailbox(thread.mailboxId);
  const sender = arr(thread.participants).map(item => address(item).name || address(item).address).filter(Boolean).slice(0,3).join(', ');
  return `<button type="button" class="cx-email-thread ${thread.id === E.selected ? 'is-selected' : ''} ${thread.unread ? 'is-unread' : ''}" data-email-thread="${esc(thread.id)}" ${thread.id === E.selected ? 'aria-current="true"' : ''}>
    <span class="cx-email-thread-top"><strong>${esc(sender || thread.subject || tr('Переписка','Conversation'))}</strong><time datetime="${esc(thread.lastMessageAt || '')}">${esc(safeDate(thread.lastMessageAt)?.toLocaleDateString(window.ChatPreferences?.locale === 'en' ? 'en-GB' : 'ru-RU',{day:'numeric',month:'short'}) || '')}</time></span>
    <span class="cx-email-thread-subject">${thread.unread ? `<span class="cx-email-unread-dot" aria-label="${esc(tr('Непрочитано','Unread'))}"></span>` : ''}${esc(thread.subject || tr('(без темы)','(no subject)'))}</span>
    <span class="cx-email-thread-preview">${esc(thread.preview)}</span>
    <span class="cx-email-thread-meta">${esc(box?.label || box?.address || '')}${box?.kind === 'shared' ? ` · ${tr('Общий ящик','Shared mailbox')}` : ''}${thread.assignedTo ? ` · ${esc(personName(thread.assignedTo))}` : ''}</span>
    <span class="cx-email-badges">${arr(thread.labels).map(label => badge(label.name || label.label || label)).join('')}${arr(thread.labelIds).map(id => arr(E.boot?.labels).find(label => label.id === id)).filter(Boolean).map(label => badge(label.name)).join('')}${thread.waitingCount ? badge(tr(`Ждём ответ: ${thread.waitingCount}`,`Waiting: ${thread.waitingCount}`),'waiting') : ''}${thread.snoozedUntil ? badge(tr('Отложено','Snoozed')) : ''}</span>
  </button>`;
}

function renderReader() {
  if (E.activeIntentId) {
    const intent = E.intents.get(E.activeIntentId);
    return `<header class="cx-email-reader-header">${button('back',tr('К списку','Back to list'),'','is-back')}<h2>${esc(intent?.subject || tr('Отправка письма','Email send attempt'))}</h2><p>${esc(addressList(intent?.to))}</p></header><div class="cx-email-message-list">${renderIntents()}${intent?.threadId ? button('intent-thread',tr('Открыть переписку','Open conversation')) : ''}</div>`;
  }
  if (E.detailLoading && E.detail?.thread?.id !== E.selected) return `<div class="cx-email-empty" role="status">${button('back',tr('К списку','Back to list'))}<p>${tr('Загружаем переписку…','Loading conversation…')}</p></div>`;
  if (E.detailError) return `<div class="cx-email-empty cx-email-error" role="alert">${button('back',tr('К списку','Back to list'))}<p>${esc(E.detailError)}</p>${button('reload-thread',tr('Повторить','Retry'))}</div>`;
  if (E.compose && !E.compose.threadId) return `<header class="cx-email-reader-header"><div>${button('back',tr('К списку','Back to list'),'','is-back')}<h2>${tr('Новое письмо','New email')}</h2></div></header>${renderComposer()}`;
  const detail = E.detail?.thread?.id === E.selected ? E.detail : null;
  if (!detail) return `<div class="cx-email-reader-welcome"><span class="cx-email-envelope" aria-hidden="true">✉</span><h2>${tr('Почта рядом с работой','Email alongside your work')}</h2><p>${tr('Откройте тему, чтобы прочитать письмо, обсудить его с командой или связать с задачей.','Open a topic to read email, discuss it with your team or link it to a Task.')}</p><p class="cx-email-caption">${tr('Личная почта доступна владельцу. Общие ящики открываются только участникам с доступом.','Personal email is available to its owner. Shared mailboxes are visible only to authorised participants.')}</p></div>`;
  const thread = detail.thread; const box = mailbox(thread.mailboxId);
  return `<header class="cx-email-reader-header"><div class="cx-email-reader-title">${button('back',tr('К списку','Back to list'),'','is-back')}<div><h2>${esc(thread.subject || tr('(без темы)','(no subject)'))}</h2><p>${esc(box?.label || box?.address || '')} · ${box?.kind === 'shared' ? tr('Общий ящик','Shared mailbox') : tr('Личный ящик','Personal mailbox')}</p></div></div>
    <div class="cx-email-reader-actions">${button('toggle-read',thread.unread ? tr('Прочитано','Mark read') : tr('Не прочитано','Mark unread'),disabled(!allowed('read',true)))}${button('archive',thread.archived ? tr('Вернуть во входящие','Move to inbox') : tr('В архив','Archive'),disabled(!allowed('archive',true)))}${button('snooze',tr('Отложить','Snooze'),disabled(!allowed('snooze',true)))}${button('thread-options',tr('Действия','Actions'))}</div>
    ${thread.assignedTo ? `<p class="cx-email-caption">${tr('Ответственный за переписку','Conversation assignee')}: ${esc(personName(thread.assignedTo))}</p>` : ''}
    ${thread.snoozedUntil ? `<p class="cx-email-notice">${tr('Вернётся во входящие','Returns to inbox')}: ${esc(dateText(thread.snoozedUntil))} ${button('unsnooze',tr('Вернуть сейчас','Return now'))}</p>` : ''}
  </header>
  <div class="cx-email-message-list" tabindex="0" aria-label="${esc(tr('История писем и заметок','Email and notes history'))}">
    ${arr(detail.messages).map(renderMessage).join('') || `<p class="cx-email-empty">${tr('Писем пока нет.','No messages yet.')}</p>`}
    ${detail.nextMessageCursor ? button('older-messages',tr('Ещё письма','More email')) : ''}
    ${renderNotes(detail.notes)}${renderRelations()}${renderWaiting()}${renderIntents()}
  </div>
  ${E.compose ? renderComposer() : `<div class="cx-email-reply-bar">${button('reply',tr('Ответить письмом','Reply by email'),disabled(box?.canReply === false),'is-primary')}${button('note-internal',tr('Обсудить с командой','Team note'),disabled(!allowed('note',box?.canReply !== false)))}${button('note-private',tr('Личная заметка','Private note'),disabled(!allowed('note',box?.canReply !== false)))}</div>`}`;
}

function splitQuote(text) {
  const lines = String(text ?? '').split('\n');
  const at = lines.findIndex((line, i) => i > 0 && (/^\s*>/.test(line) || /^\s*(On .+wrote:|Le .+écrit\s*:|El .+escribió:|_{5,}|-{3,}\s*(Original Message|Исходное сообщение))\s*$/i.test(line)));
  return at < 0 ? {text:lines.join('\n'), quote:''} : {text:lines.slice(0, at).join('\n'), quote:lines.slice(at).join('\n')};
}

function renderMessage(message) {
  const body = splitQuote(message.text || message.body || '');
  return `<article class="cx-email-message ${outgoing(message) ? 'is-outbound' : ''}" data-email-message="${esc(message.id)}">
    <header><div><strong>${esc(displayAddress(message.from))}</strong><div class="cx-email-message-recipients">${tr('Кому','To')}: ${esc(addressList(message.to))}${arr(message.cc).length ? `<br>Cc: ${esc(addressList(message.cc))}` : ''}${arr(message.bcc).length ? `<br>Bcc: ${esc(addressList(message.bcc))}` : ''}</div></div><time datetime="${esc(message.sentAt || message.receivedAt || '')}">${esc(dateText(message.sentAt || message.receivedAt))}</time></header>
    <div class="cx-email-badges">${badge(sourceLabel(message.sourceKind))}${outgoing(message) ? badge(tr('Исходящее','Outgoing')) : ''}</div>
    ${message.providerDeleted ? `<p class="cx-email-notice">${tr('Письмо удалено у провайдера. Здесь доступна ранее сохранённая копия.','This email was deleted at the provider. A previously saved copy remains here.')}</p>` : ''}
    ${message.textTruncated || (message.bodyStatus && message.bodyStatus !== 'complete') ? `<p class="cx-email-notice">${message.bodyStatus === 'too_large' ? tr('Письмо превышает лимит загрузки. Полный текст доступен у почтового провайдера.','This email exceeds the download limit. The full content is available at the mail provider.') : message.bodyStatus === 'unparseable' ? tr('Текст письма не удалось разобрать. Используйте оригинал, если он доступен.','The email content could not be parsed. Use the original file if available.') : tr('Текст показан не полностью. Проверьте оригинал письма.','The displayed text is incomplete. Check the original email.')}</p>` : ''}
    <div class="cx-email-message-body">${esc(body.text || tr('(письмо без текста)','(email has no text)'))}</div>
    ${body.quote ? `<details class="cx-email-quote"><summary>${tr('Показать цитату','Show quoted text')}</summary><div>${esc(body.quote)}</div></details>` : ''}
    ${arr(message.attachments).length ? `<ul class="cx-email-attachments">${arr(message.attachments).map(renderAttachment).join('')}</ul>` : ''}
    <footer>${message.hasOriginal !== false ? `<a class="cx-email-link" href="${ROOT}/messages/${idPath(message.id)}/original" download>${tr('Оригинал .eml','Original .eml')}</a>` : ''}${button('message-actions',tr('Связать с работой','Link to work'),`data-email-message-id="${esc(message.id)}" ${disabled(!allowed('reply',true))}`)}</footer>
  </article>`;
}

function renderAttachment(file) {
  const available = file.canDownload !== false && !['quarantined','blocked','scanning'].includes(file.scanStatus || file.status);
  const name = file.filename || file.name || tr('Вложение','Attachment');
  return `<li>${available ? `<a href="${ROOT}/attachments/${idPath(file.id)}/content" download class="cx-email-link">${esc(name)}</a>` : `<span>${esc(name)}</span>`}${file.size ? `<small>${esc(Math.ceil(file.size / 1024))} KB</small>` : ''}${!available ? `<small>${tr('Файл пока недоступен','File is not available yet')}</small>` : file.scanStatus === 'unscanned' ? `<small>${tr('Проверка файла не выполнялась','File has not been scanned')}</small>` : ''}</li>`;
}

function renderNotes(notes) {
  return arr(notes).map(note => `<article class="cx-email-note is-${note.kind === 'private' ? 'private' : 'internal'}" data-email-note="${esc(note.id)}"><header>${badge(note.kind === 'private' ? tr('Личная заметка · только вам','Private note · only you') : tr('Командная заметка · не отправляется по email','Team note · not sent by email'))}<span>${esc(personName(note.authorId))} · ${esc(dateText(note.createdAt))}</span></header><p>${esc(note.text)}</p>${note.canDelete || note.authorId === userId() ? button('delete-note',tr('Удалить заметку','Delete note'),`data-email-note-id="${esc(note.id)}"`) : ''}</article>`).join('');
}

function renderRelations() {
  const kinds = [['taskLinks','task',tr('Задача','Task')],['eventLinks','event',tr('Встреча','Meeting')],['pageLinks','page',tr('Страница','Page')],['decisionLinks','decision',tr('Решение','Decision')]];
  const rows = kinds.flatMap(([field, kind, label]) => (arr(E.detail?.resourceLinks).length ? E.detail.resourceLinks.filter(link => link.kind === kind) : arr(E.detail?.[field])).map(link => {
    const entityId = link.resourceId || link[`${kind}Id`] || link.resource?.id || link.id;
    return `<button type="button" class="cx-email-relation" data-email-open-kind="${kind}" data-email-open-id="${esc(entityId)}"><span>${label}</span><strong>${esc(link.resource?.title || link.title || link[kind]?.title || label)}</strong><span>${esc(link.status || link[kind]?.status || '')}</span></button>`;
  }));
  return rows.length ? `<section class="cx-email-relations"><h3>${tr('Связано с работой','Linked work')}</h3>${rows.join('')}</section>` : '';
}

function renderWaiting() {
  const rows = arr(E.detail?.waiting);
  if (!rows.length) return '';
  return `<section class="cx-email-waiting"><h3>${tr('Внешние ожидания','External waiting items')}</h3><p class="cx-email-caption">${tr('Ожидание ответа не означает, что внешний человек принял задачу.','Waiting for a reply does not mean the external person accepted a Task.')}</p>${rows.map(item => `<article data-email-waiting="${esc(item.id)}"><div><strong>${esc(item.title)}</strong>${badge(item.status === 'answered' ? tr('Ответ получен','Reply recorded') : item.status === 'cancelled' ? tr('Отменено','Cancelled') : tr('Ждём ответ','Waiting for reply'),'waiting')}</div><p>${esc(item.externalAddress)} · ${tr('Контролирует','Monitored by')}: ${esc(personName(item.controllerId))}</p><dl><dt>${tr('Срок ответа','Reply due')}</dt><dd>${esc(dateText(item.dueAt))}</dd>${item.createdAt ? `<dt>${tr('Ожидание создано','Waiting item created')}</dt><dd>${esc(dateText(item.createdAt))}</dd>` : ''}${item.answeredAt ? `<dt>${tr('Ответ зафиксирован','Reply recorded')}</dt><dd>${esc(dateText(item.answeredAt))}</dd>` : ''}</dl>${item.status === 'waiting' ? `<div class="cx-email-actions">${button('waiting-answer',tr('Зафиксировать ответ','Record reply'),`data-email-waiting-id="${esc(item.id)}"`)}${button('waiting-cancel',tr('Отменить ожидание','Cancel waiting'),`data-email-waiting-id="${esc(item.id)}"`)}</div>` : ''}</article>`).join('')}</section>`;
}

function renderIntents() {
  const intents = [...E.intents.values()].filter(intent => E.activeIntentId ? intent.id === E.activeIntentId : (E.selected && intent.threadId === E.selected) || (E.compose?.id && intent.draftId === E.compose.id) || arr(E.detail?.sendIntents).some(i => i.id === intent.id));
  return intents.length ? `<section class="cx-email-send-status" aria-live="polite"><h3>${tr('Отправка','Sending')}</h3>${intents.map(intent => `<article data-email-send-intent="${esc(intent.id)}"><strong>${esc(intent.partial ? tr('Принято только для части адресатов','Accepted for some recipients only') : sendLabel(intent.state || intent.status))}</strong>${intent.scheduledAt ? `<p>${tr('Время отправки','Send time')}: ${esc(dateText(intent.scheduledAt))}</p>` : ''}${(intent.state || intent.status) === 'provider_accepted' ? `<p>${tr('Приём провайдером не подтверждает доставку адресату или прочтение.','Provider acceptance does not confirm delivery to or reading by the recipient.')}</p>` : ''}${intent.partial ? `<p>${tr('Принято для','Accepted for')}: ${esc(addressList(intent.acceptedRecipients)) || '—'}</p><p class="cx-email-error">${tr('Отклонены','Rejected')}: ${esc(addressList(intent.rejectedRecipients)) || '—'}</p><p>${tr('Проверьте отклонённые адреса. Повтор всей отправки может создать дубликаты у остальных получателей.','Check the rejected addresses. Repeating the entire send may create duplicates for the other recipients.')}</p>` : ''}${intent.sentCopy ? `<p>${esc(sentCopyLabel(intent.sentCopy.status))}${intent.sentCopy.folder ? ` · ${esc(intent.sentCopy.folder)}` : ''}. ${tr('Состояние копии не меняет результат передачи письма.','The copy status does not change the send outcome.')}</p>` : ''}${(intent.state || intent.status) === 'unknown_outcome' ? `<p>${tr('Не отправляйте копию: провайдер мог уже принять письмо. Проверьте статус исходной попытки.','Do not send a copy: the provider may have accepted this email. Check the original attempt’s status.')}</p>` : ''}${intent.error?.message || intent.lastError ? `<p class="cx-email-error">${esc(intent.error?.message || intent.lastError)}</p>` : ''}<div class="cx-email-actions">${button('check-send',tr('Проверить статус','Check status'),`data-email-intent-id="${esc(intent.id)}"`)}${intent.canCancel || ['queued','scheduled','needs_approval'].includes(intent.state || intent.status) ? button('cancel-send',tr('Отменить отправку','Cancel send'),`data-email-intent-id="${esc(intent.id)}"`) : ''}</div></article>`).join('')}</section>` : '';
}

function composeFromDraft(draft) {
  const localKey = draft.threadId ? `thread:${draft.threadId}` : `draft:${draft.id}`;
  const compose = {...draft, id:draft.id, localKey, mode:'external',
    to:addressList(draft.to), cc:addressList(draft.cc), bcc:addressList(draft.bcc),
    text:draft.text || '', fromAddress:draft.fromAddress || mailbox(draft.mailboxId)?.address || '',
    dirty:false, saving:false, savedAt:draft.updatedAt || null, conflict:false, showCc:arr(draft.cc).length > 0 || arr(draft.bcc).length > 0,
  };
  E.composers.set(localKey, compose); return compose;
}

function openComposer(mode = 'external', reply = true) {
  captureComposer();
  E.activeIntentId = null;
  const thread = reply ? E.detail?.thread : null;
  const box = mailbox(thread?.mailboxId) ?? arr(E.boot?.mailboxes).find(b => b.canReply !== false);
  if (!box) { openSettings(); return; }
  const localKey = thread ? `thread:${thread.id}` : `new:${box.id}`;
  const prior = E.composers.get(localKey);
  if (prior && prior.mode === mode) E.compose = prior;
  else {
    const latest = [...arr(E.detail?.messages)].reverse().find(message => !outgoing(message));
    const from = address(latest?.replyTo?.[0] || latest?.from);
    E.compose = {
      localKey, mode, mailboxId:box.id, threadId:thread?.id ?? null,
      replyToMessageId:thread ? latest?.id ?? arr(E.detail?.messages).at(-1)?.id : null,
      fromAddress:box.address || '', to:thread && from.address ? displayAddress(from) : '', cc:'', bcc:'',
      subject:thread?.subject ? (/^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`) : '',
      text:'', attachments:[], version:null, dirty:false, saving:false, showCc:false,
      priorModes:prior ? {...prior.priorModes, [prior.mode]:prior} : {},
    };
    if (prior?.priorModes?.[mode]) E.compose = {...prior.priorModes[mode], priorModes:E.compose.priorModes};
    E.composers.set(localKey, E.compose);
  }
  if (!thread) { E.selected = null; E.detail = null; }
  render(); E.host?.querySelector('[data-email-field="compose-text"]')?.focus({preventScroll:true});
}

function renderComposer() {
  const compose = E.compose; if (!compose) return '';
  const external = compose.mode === 'external'; const box = mailbox(compose.mailboxId);
  const canSend = cap('canSend') && box?.canSend === true && box?.canReply !== false && !compose.sendUncertain;
  const aliases = [box?.address, ...arr(box?.aliases).filter(alias => typeof alias === 'string' || alias.verified !== false).map(alias => typeof alias === 'string' ? alias : alias.address)].filter(Boolean);
  const status = compose.saving ? tr('Сохраняем…','Saving…') : compose.error ? compose.error : compose.dirty ? offline() ? tr('Пока только в этой вкладке — нет сети','Only in this tab for now — offline') : tr('Есть несохранённые изменения','Unsaved changes') : compose.savedAt ? tr(`Сохранено: ${dateText(compose.savedAt)}`,`Saved: ${dateText(compose.savedAt)}`) : external ? tr('Черновик ещё не сохранён','Draft not saved yet') : tr('Заметка ещё не опубликована','Note not posted yet');
  return `<section class="cx-email-composer is-${compose.mode}" data-email-composer>
    <div class="cx-email-compose-modes" role="group" aria-label="${esc(tr('Куда отправляется текст','Text destination'))}">${[['external',tr('Письмо','Email')],['internal',tr('Команде','Team note')],['private',tr('Только мне','Private note')]].filter(([mode]) => compose.threadId || mode === 'external').map(([mode, label]) => `<button type="button" data-email-compose-mode="${mode}" aria-pressed="${compose.mode === mode}">${label}</button>`).join('')}</div>
    <p class="cx-email-destination">${external ? tr('Внешнее письмо — получатели увидят текст и вложения.','External email — recipients will see the text and attachments.') : compose.mode === 'private' ? tr('Личная заметка — доступна только вам. По почте не отправляется.','Private note — visible only to you. Never sent by email.') : tr('Командная заметка — доступна участникам этого ящика. По почте не отправляется.','Team note — visible to this mailbox’s participants. Never sent by email.')}</p>
    <form data-email-compose-form data-email-compose-key="${esc(`${compose.localKey}:${compose.mode}`)}" class="cx-email-compose-form">
      <div class="cx-email-compose-fields">
      ${external ? `<div class="cx-email-address-fields"><label><span>${tr('От','From')}</span><select name="fromAddress" data-email-field="compose-from">${[...new Set(aliases.length ? aliases : [compose.fromAddress])].map(alias => `<option value="${esc(alias)}" ${alias === compose.fromAddress ? 'selected' : ''}>${esc(alias)}</option>`).join('')}</select></label>
      <label><span>${tr('Кому','To')}</span><input name="to" data-email-field="compose-to" value="${esc(compose.to)}" placeholder="name@example.com" autocomplete="off"></label>
      ${compose.showCc ? `<label><span>Cc</span><input name="cc" data-email-field="compose-cc" value="${esc(compose.cc)}" autocomplete="off"></label><label><span>Bcc</span><input name="bcc" data-email-field="compose-bcc" value="${esc(compose.bcc)}" autocomplete="off"></label>` : button('show-cc',tr('Копия / скрытая копия','Cc / Bcc'),'','is-quiet')}
      <label><span>${tr('Тема','Subject')}</span><input name="subject" data-email-field="compose-subject" value="${esc(compose.subject)}" maxlength="998"></label></div>` : ''}
      <label class="cx-email-sr-only" for="cx-email-compose-text">${external ? tr('Текст письма','Email text') : tr('Текст заметки','Note text')}</label><textarea id="cx-email-compose-text" name="text" data-email-field="compose-text" rows="6" placeholder="${esc(external ? tr('Напишите ответ…','Write a reply…') : tr('Напишите заметку…','Write a note…'))}">${esc(compose.text)}</textarea>
      ${external && arr(compose.attachments).length ? `<ul class="cx-email-draft-files">${arr(compose.attachments).map(file => `<li><span>${esc(file.filename || file.name)}</span>${button('remove-draft-file',tr('Убрать','Remove'),`data-email-file-id="${esc(file.id)}"`)}</li>`).join('')}</ul>` : ''}
      <div class="cx-email-compose-tools">${external ? `${button('attach',tr('Вложение','Attach file'),disabled(!cap('canAttachFiles')))}${button('templates',tr('Шаблон','Template'),disabled(!cap('canUseTemplates') && !arr(E.boot?.templates).length))}${button('signature',tr('Подпись','Signature'),disabled(!E.preferences?.signature && !box?.signature))}${button('discard-draft',tr('Удалить черновик','Delete draft'),disabled(offline() || compose.saving),'is-quiet')}<input type="file" data-email-file-input hidden multiple>` : ''}${button('close-composer',tr('Свернуть','Collapse'),'','is-quiet')}</div>
      </div>
      <p class="cx-email-save-state ${compose.error ? 'cx-email-error' : ''}" role="status" data-email-save-state>${esc(status)}</p>
      ${compose.conflict ? `<p class="cx-email-error">${tr('Черновик изменён в другом окне. Ваш текст сохранён в этой вкладке; перед отправкой сравните версии.','This draft changed in another window. Your text is kept in this tab; compare versions before sending.')}${button('resolve-draft',tr('Сравнить версии','Compare versions'))}</p>` : ''}
      <div class="cx-email-compose-submit">${external ? `${button('save-draft',tr('Сохранить черновик','Save draft'),disabled(compose.saving || offline()))}${box?.requireApproval && (box?.canApprove || box?.canManage) && compose.authorId && compose.authorId !== userId() ? button('approve-draft',tr('Одобрить эту версию','Approve this version'),disabled(compose.conflict || offline())) : ''}${button('schedule',tr('Отправить позже','Send later'),disabled(!canSend || compose.conflict || offline()))}<button type="submit" class="cx-email-button is-primary" ${disabled(!canSend || compose.conflict || offline())}>${tr('Отправить','Send')}</button>` : `<button type="submit" class="cx-email-button is-primary" ${disabled(offline() || compose.saving)}>${compose.mode === 'private' ? tr('Сохранить личную заметку','Save private note') : tr('Опубликовать для команды','Post team note')}</button>`}</div>
      ${external && box?.requireApproval ? `<p class="cx-email-caption">${compose.approvedVersion === compose.version ? tr('Эта версия одобрена другим управляющим.','This version was approved by another manager.') : tr('Для отправки эту версию должен одобрить другой управляющий ящиком.','Another mailbox manager must approve this version before it can be sent.')}</p>` : ''}
      ${external && !canSend ? `<p class="cx-email-caption">${tr('Отправка недоступна для этого ящика: настройте и проверьте почтового провайдера. Черновик можно сохранить.','Sending is unavailable for this mailbox: configure and verify a mail provider. You can save a draft.')}</p>` : ''}
      ${compose.sendUncertain ? `<p class="cx-email-error">${tr('Подтверждение отправки не получено. Проверьте очередь перед повторной попыткой.','Send confirmation was not received. Check the outbox before retrying.')}${button('open-outbox',tr('Открыть очередь','Open outbox'))}</p>` : ''}
    </form>
  </section>`;
}

function onClick(event) {
  const target = event.target.closest('button, a');
  if (!target || !E.host?.contains(target) || target.disabled) return;
  if (target.dataset.emailThread) { openThread(target.dataset.emailThread); return; }
  if (target.dataset.emailDraft) { openDraft(target.dataset.emailDraft); return; }
  if (target.dataset.emailIntent) { captureComposer(); E.compose = null; E.selected = null; E.detail = null; E.activeIntentId = target.dataset.emailIntent; render(); return; }
  if (target.dataset.emailFolder) {
    captureComposer(); E.folder = target.dataset.emailFolder; E.selected = null; E.detail = null; E.compose = null; E.activeIntentId = null;
    loadThreads(); return;
  }
  if (target.dataset.emailContact) { E.query = target.dataset.emailContact; E.peopleView = false; loadThreads(); return; }
  if (target.dataset.emailComposeMode) {
    captureComposer(); clearTimeout(E.saveTimer);
    const next = target.dataset.emailComposeMode;
    if (next === E.compose?.mode) return;
    const current = E.compose;
    openComposer(next, true);
    if (current && E.compose) E.compose.priorModes = {...current.priorModes, [current.mode]:current};
    return;
  }
  if (target.dataset.emailOpenKind) { openCanonical(target.dataset.emailOpenKind, target.dataset.emailOpenId); return; }
  const action = target.dataset.emailAction;
  if (!action) return;
  event.preventDefault();
  const actions = {
    settings:openSettings, filters:openFilters, new:() => openComposer('external', false),
    refresh, 'load-more':() => loadThreads({append:true}),
    'threads-view':() => { E.peopleView = false; render(); }, 'people-view':() => { E.peopleView = true; render(); },
    back:() => { captureComposer(); E.selected = null; E.detail = null; E.compose = null; E.detailError = ''; E.activeIntentId = null; try { history.replaceState(null,'','#/chats/email'); } catch {} render(); },
    reply:() => openComposer('external'), 'note-internal':() => openComposer('internal'), 'note-private':() => openComposer('private'),
    'close-composer':() => { captureComposer(); E.compose = null; render(); },
    'show-cc':() => { captureComposer(); E.compose.showCc = true; render(); },
    'save-draft':() => saveDraft({notify:true}), 'discard-draft':discardDraft, 'resolve-draft':resolveDraftConflict, 'approve-draft':approveDraft,
    'reload-thread':() => E.selected && loadThread(E.selected,{keepComposer:true}),
    'toggle-read':() => mutateThread({unread:!E.detail.thread.unread}),
    archive:() => mutateThread({archived:!E.detail.thread.archived}),
    snooze:openSnooze, unsnooze:() => mutateThread({snoozedUntil:null}),
    'thread-options':openThreadOptions, 'message-actions':() => openMessageActions(target.dataset.emailMessageId),
    'delete-note':() => deleteNote(target.dataset.emailNoteId),
    'waiting-answer':() => resolveWaiting(target.dataset.emailWaitingId),
    'waiting-cancel':() => updateWaiting(target.dataset.emailWaitingId, 'cancelled'),
    schedule:() => prepareSend(true), 'check-send':() => checkSend(target.dataset.emailIntentId),
    'cancel-send':() => cancelSend(target.dataset.emailIntentId),
    import:openImport, attach:() => E.host.querySelector('[data-email-file-input]')?.click(),
    'remove-draft-file':() => removeAttachment(target.dataset.emailFileId),
    signature:insertSignature, templates:openTemplatePicker,
    'older-messages':loadOlderMessages, 'restore-drafts':openRecovery, 'discard-recovery':() => { clearRecovery(); render(); },
    'intent-thread':() => openThread(E.intents.get(E.activeIntentId)?.threadId),
    'open-outbox':() => { captureComposer(); E.folder = 'outbox'; E.selected = null; E.compose = null; E.detail = null; E.activeIntentId = null; closeSheet(); loadThreads(); },
  };
  Promise.resolve(actions[action]?.()).catch(report);
}

function onInput(event) {
  if (!event.target.closest('[data-email-compose-form]') || !E.compose) return;
  captureComposer(); E.compose.dirty = true; E.compose.error = '';
  persistRecovery();
  updateSaveStatus();
  clearTimeout(E.saveTimer);
  if (E.compose.mode === 'external' && !E.compose.conflict && !offline()) {
    const compose = E.compose;
    E.saveTimer = setTimeout(() => saveDraft({compose}).catch(() => {}), 1000);
  }
}

function onChange(event) {
  if (event.target.matches('[data-email-mailbox]')) {
    captureComposer(); E.mailboxId = event.target.value; E.selected = null; E.detail = null; E.compose = null; loadThreads();
  }
  if (event.target.matches('[data-email-file-input]')) {
    const files = [...event.target.files]; event.target.value = '';
    uploadAttachments(files).catch(report);
  }
}

function onSubmit(event) {
  if (event.target.matches('[data-email-search]')) {
    event.preventDefault(); E.query = event.target.elements.q.value; E.peopleView = false; loadThreads(); return;
  }
  if (event.target.matches('[data-email-compose-form]')) {
    event.preventDefault(); captureComposer();
    Promise.resolve(E.compose?.mode === 'external' ? prepareSend(false) : saveNote()).catch(report);
  }
}

function updateSaveStatus() {
  const node = E.host?.querySelector('[data-email-save-state]');
  if (!node || !E.compose) return;
  const compose = E.compose;
  node.textContent = compose.saving ? tr('Сохраняем…','Saving…') : compose.error || (compose.dirty ? offline() ? tr('Пока только в этой вкладке — нет сети','Only in this tab for now — offline') : tr('Есть несохранённые изменения','Unsaved changes') : compose.savedAt ? tr(`Сохранено: ${dateText(compose.savedAt)}`,`Saved: ${dateText(compose.savedAt)}`) : tr('Черновик ещё не сохранён','Draft not saved yet'));
  node.classList.toggle('cx-email-error', Boolean(compose.error));
}

function parseAddresses(value) {
  if (!String(value ?? '').trim()) return [];
  const parts = []; let part = '', quoted = false, escaped = false, angle = false;
  for (const char of String(value)) {
    if (escaped) { part += char; escaped = false; continue; }
    if (char === '\\' && quoted) { part += char; escaped = true; continue; }
    if (char === '"') quoted = !quoted;
    if (!quoted && char === '<') angle = true;
    if (!quoted && char === '>') angle = false;
    if (!quoted && !angle && /[,;\r\n]/.test(char)) { parts.push(part); part = ''; }
    else part += char;
  }
  if (quoted || angle) throw new Error(tr('Проверьте кавычки и скобки в адресатах.','Check the quotes and brackets in the recipients.'));
  parts.push(part);
  return parts.map(part => part.trim()).filter(Boolean).map(part => {
    const match = part.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/);
    const email = (match ? match[2] : part).trim();
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new Error(tr(`Проверьте адрес: ${email}`,`Check the address: ${email}`));
    return {address:email, ...(match?.[1] ? {name:match[1].replace(/^"|"$/g,'').replace(/\\([\\"])/g,'$1')} : {})};
  });
}

function draftPayload(compose) {
  return {mailboxId:compose.mailboxId, ...(compose.threadId ? {threadId:compose.threadId} : {}),
    ...(compose.replyToMessageId ? {replyToMessageId:compose.replyToMessageId} : {}),
    fromAddress:compose.fromAddress, to:parseAddresses(compose.to), cc:parseAddresses(compose.cc), bcc:parseAddresses(compose.bcc),
    subject:compose.subject || '', text:compose.text || '', attachments:arr(compose.attachments).map(file => file.id),
  };
}

function retainPendingNotes(compose) {
  E.composers.delete(compose.localKey);
  const notes = Object.fromEntries(Object.entries(compose.priorModes || {}).filter(([mode]) => mode !== 'external'));
  const note = Object.values(notes).find(value => value?.text?.trim());
  if (note) E.composers.set(compose.localKey,{...note,priorModes:notes});
}

function discardDraft() {
  captureComposer();
  const compose = E.compose;
  if (!compose || compose.mode !== 'external') return;
  clearTimeout(E.saveTimer);
  sheet(tr('Удалить черновик?','Delete this draft?'),`<p>${tr('Текст этого черновика и его вложения будут убраны. Исходные письма и опубликованные заметки сохранятся.','This draft text and its attachments will be removed. Original email and posted notes remain.')}</p><form><button type="submit" class="cx-email-button is-danger">${tr('Удалить черновик','Delete draft')}</button></form>`,root => bindForm(root.querySelector('form'),async () => {
    if (compose.pendingSave) await compose.pendingSave;
    if (compose.id) await api(`/drafts/${idPath(compose.id)}`,{method:'DELETE',body:{expectedVersion:compose.version}});
    retainPendingNotes(compose);
    E.recoverable = arr(E.recoverable).filter(item => item.localKey !== compose.localKey);
    if (E.detail) E.detail.drafts = arr(E.detail.drafts).filter(item => item.id !== compose.id);
    E.draftItems = E.draftItems.filter(item => item.id !== compose.id);
    if (E.compose === compose) E.compose = null;
    persistRecovery(); closeSheet(); render(); await loadThreads();
    E.bridge.toast?.(tr('Черновик удалён','Draft deleted'));
  }));
}

async function saveDraft({compose = E.compose, notify = false} = {}) {
  if (!compose || compose.mode !== 'external') return null;
  if (compose === E.compose) captureComposer();
  if (compose.conflict) throw new Error(tr('Сначала сравните версии черновика.','Compare draft versions first.'));
  if (compose.id && !compose.dirty && !compose.saving) { if (notify) E.bridge.toast?.(tr('Черновик сохранён','Draft saved')); return compose; }
  if (compose.saving) {
    await compose.pendingSave;
    if (!compose.dirty) return compose;
    return saveDraft({compose,notify});
  }
  if (offline()) { compose.dirty = true; updateSaveStatus(); throw new Error(tr('Нет сети. Черновик остаётся только в этой вкладке.','Offline. The draft is kept only in this tab.')); }
  const snapshot = draftPayload(compose);
  const snapshotText = JSON.stringify(snapshot);
  const identity = E.sessionKey;
  compose.saving = true; compose.error = ''; updateSaveStatus();
  compose.pendingSave = (async () => {
    try {
      const result = await api(compose.id ? `/drafts/${idPath(compose.id)}` : '/drafts', {
        method:compose.id ? 'PATCH' : 'POST',
        body:{...snapshot, ...(compose.id ? {expectedVersion:compose.version} : {})},
      });
      if (identity !== E.sessionKey) return null;
      const saved = result.draft;
      if (!saved?.id) throw new Error(tr('Сервер не подтвердил сохранение черновика.','The server did not confirm the draft was saved.'));
      compose.id = saved.id; compose.version = saved.version; compose.authorId = saved.authorId; compose.savedAt = saved.updatedAt || new Date().toISOString();
      compose.approvedVersion = saved.approvedVersion; compose.approvedBy = saved.approvedBy;
      if (saved.threadId) compose.threadId = saved.threadId;
      if (arr(saved.attachments).some(file => typeof file === 'object')) compose.attachments = saved.attachments;
      if (compose === E.compose) captureComposer();
      compose.dirty = JSON.stringify(draftPayload(compose)) !== snapshotText;
      compose.error = ''; E.composers.set(compose.localKey, compose); persistRecovery();
      if (notify) E.bridge.toast?.(tr('Черновик сохранён','Draft saved'));
      return compose;
    } catch (error) {
      if (identity === E.sessionKey) {
        compose.error = error.message;
        if (error.status === 409) compose.conflict = true;
        compose.dirty = true;
        if (notify) report(error);
      }
      throw error;
    } finally {
      compose.saving = false; compose.pendingSave = null;
      if (identity === E.sessionKey) { updateSaveStatus(); if (compose.conflict) render(); }
    }
  })();
  return compose.pendingSave;
}

async function saveNote() {
  const compose = E.compose; if (!compose?.threadId || compose.mode === 'external') return;
  if (!compose.text.trim()) throw new Error(tr('Введите текст заметки.','Enter a note.'));
  compose.saving = true; render();
  try {
    await api(`/threads/${idPath(compose.threadId)}/notes`,{method:'POST',body:{kind:compose.mode,text:compose.text}});
    compose.text = ''; compose.dirty = false;
    E.composers.delete(compose.localKey);
    const remaining = Object.fromEntries(Object.entries(compose.priorModes || {}).filter(([mode]) => mode !== compose.mode));
    const continuation = remaining.external || Object.values(remaining).find(value => value?.text?.trim());
    if (continuation) { continuation.priorModes = remaining; E.composers.set(compose.localKey,continuation); }
    E.compose = null; persistRecovery();
    await loadThread(compose.threadId,{keepComposer:true});
    E.bridge.toast?.(compose.mode === 'private' ? tr('Личная заметка сохранена','Private note saved') : tr('Командная заметка опубликована','Team note posted'));
  } catch (error) { compose.error = error.message; throw error; }
  finally { compose.saving = false; render(); }
}

async function mutateThread(patch) {
  const thread = E.detail?.thread; if (!thread) return;
  try {
    const result = await api(`/threads/${idPath(thread.id)}`,{method:'PATCH',body:{...patch,expectedVersion:thread.version}});
    if (E.detail?.thread?.id === thread.id) E.detail.thread = result.thread;
    const index = E.items.findIndex(item => item.id === thread.id);
    if (index >= 0) E.items[index] = {...E.items[index], ...result.thread};
    render();
    if (own(patch,'archived') || own(patch,'snoozedUntil') || E.folder === 'unread') await loadThreads();
  } catch (error) {
    if (error.status === 409) {
      E.bridge.toast?.(tr('Переписка уже изменилась. Обновили её; повторите действие с актуальными данными.','The conversation changed. It has been refreshed; retry the action with the current data.'));
      await loadThread(thread.id,{keepComposer:true});
    } else throw error;
  }
}

async function loadOlderMessages() {
  if (!E.detail?.nextMessageCursor || !E.selected) return;
  const threadId = E.selected;
  const result = await api(`/threads/${idPath(threadId)}?messageCursor=${encodeURIComponent(E.detail.nextMessageCursor)}`);
  if (E.selected !== threadId) return;
  E.detail.messages = [...new Map([...arr(E.detail.messages), ...arr(result.messages)].map(message => [message.id,message])).values()];
  E.detail.nextMessageCursor = result.nextMessageCursor ?? null; render();
}

function sheet(title, body, setup, {wide = false, kind = ''} = {}) {
  const replacing = Boolean(E.sheet);
  captureComposer(); closeSheet('replace');
  const backdrop = document.createElement('div');
  backdrop.className = 'cx-email-sheet-backdrop'; backdrop.setAttribute('data-prefs-owned','');
  backdrop.innerHTML = `<section class="cx-email-sheet ${wide ? 'is-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="cx-email-sheet-title" tabindex="-1"><header><h2 id="cx-email-sheet-title">${esc(title)}</h2><button type="button" class="cx-email-sheet-close" data-email-sheet-close aria-label="${esc(tr('Закрыть','Close'))}">×</button></header><div class="cx-email-sheet-body">${body}</div></section>`;
  E.sheetOpener = document.activeElement; E.sheet = backdrop; E.sheetKind = kind;
  document.body.append(backdrop);
  const onKey = event => {
    if (!E.sheet || E.sheet !== backdrop) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeSheet(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...backdrop.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')].filter(node => !node.closest('[hidden]') && node.getClientRects().length);
    if (!focusable.length) { event.preventDefault(); return; }
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown',onKey,true);
  E.sheetDispose = () => document.removeEventListener('keydown',onKey,true);
  backdrop.querySelector('[data-email-sheet-close]').onclick = () => closeSheet();
  backdrop.onclick = event => { if (event.target === backdrop) closeSheet(); };
  if (!replacing) E.bridge.ghostOverlay?.push?.(() => closeSheet('pop'));
  setup?.(backdrop.querySelector('.cx-email-sheet-body'),backdrop);
  backdrop.querySelector('input:not([type="checkbox"]),textarea,select,button')?.focus({preventScroll:true});
  return backdrop;
}

function closeSheet(reason = 'button') {
  if (!E.sheet) return;
  const opener = E.sheetOpener;
  E.sheetDispose?.(); E.sheetDispose = null;
  E.sheet.remove(); E.sheet = null; E.sheetKind = null; E.sheetOpener = null;
  if (reason === 'button') E.bridge.ghostOverlay?.close?.();
  else if (reason !== 'pop' && reason !== 'replace') E.bridge.ghostOverlay?.drop?.();
  if (reason !== 'navigate' && reason !== 'reset' && reason !== 'replace' && opener?.isConnected) opener.focus({preventScroll:true});
}

function formError(form, error) {
  let node = form.querySelector('[data-email-form-error]');
  if (!node) { node = document.createElement('p'); node.className = 'cx-email-error'; node.setAttribute('role','alert'); node.dataset.emailFormError = ''; form.append(node); }
  node.textContent = error?.message ?? String(error);
}

function bindForm(form, submit) {
  form.onsubmit = async event => {
    event.preventDefault();
    if (form.dataset.busy) return;
    form.dataset.busy = 'true';
    const button = form.querySelector('[type="submit"]');
    if (button) button.disabled = true;
    form.querySelector('[data-email-form-error]')?.remove();
    try { await submit(new FormData(form),form); }
    catch (error) { formError(form,error); }
    finally { delete form.dataset.busy; if (button?.isConnected) button.disabled = false; }
  };
}

function textField(name, title, {value = '', type = 'text', required = false, min = '', hint = '', textarea = false} = {}) {
  return `<label class="cx-email-field"><span>${esc(title)}</span>${textarea ? `<textarea name="${name}" ${required ? 'required' : ''} rows="4">${esc(value)}</textarea>` : `<input name="${name}" type="${type}" value="${esc(value)}" ${required ? 'required' : ''} ${min ? `min="${esc(min)}"` : ''}>`}${hint ? `<small>${esc(hint)}</small>` : ''}</label>`;
}

function personField(name, title, selected, {empty = false, multiple = false} = {}) {
  const chosen = selected === undefined ? (empty || multiple ? '' : userId()) : selected;
  return `<label class="cx-email-field"><span>${esc(title)}</span><select name="${name}" ${multiple ? 'multiple' : ''}>${empty ? `<option value="" ${!chosen ? 'selected' : ''}>${tr('Не назначен','Unassigned')}</option>` : ''}${people().map(person => `<option value="${esc(person.id || person.userId)}" ${(person.id || person.userId) === chosen ? 'selected' : ''}>${esc(person.displayName || person.name || person.email)}</option>`).join('')}</select></label>`;
}

function openFilters() {
  sheet(tr('Папки и ящики','Folders and mailboxes'),renderSidebar(),root => {
    root.querySelector('[data-email-mailbox]').onchange = event => { E.mailboxId = event.target.value; E.selected = null; E.detail = null; E.compose = null; closeSheet(); loadThreads(); };
    root.querySelectorAll('[data-email-folder]').forEach(node => { node.onclick = () => { E.folder = node.dataset.emailFolder; E.selected = null; E.detail = null; E.compose = null; closeSheet(); loadThreads(); }; });
    root.querySelectorAll('[data-email-action]').forEach(node => { node.onclick = () => {
      const action = node.dataset.emailAction; closeSheet('navigate');
      ({settings:openSettings,new:() => openComposer('external',false),import:openImport,refresh})[action]?.();
    }; });
  });
}

function openSnooze() {
  const tomorrow = new Date(Date.now() + 86400000); tomorrow.setHours(9,0,0,0);
  sheet(tr('Отложить переписку','Snooze conversation'),`<form class="cx-email-form">${textField('until',tr('Вернуть во входящие','Return to inbox'),{type:'datetime-local',value:datetimeValue(E.detail?.thread?.snoozedUntil || tomorrow),required:true})}<p class="cx-email-caption">${tr('Это время напоминания о переписке. Срок задачи и срок внешнего ответа не меняются.','This is a conversation reminder. Task commitments and external reply deadlines stay separate.')}</p><button type="submit" class="cx-email-button is-primary">${tr('Отложить','Snooze')}</button></form>`,root => bindForm(root.querySelector('form'),async data => {
    const until = safeDate(data.get('until'));
    if (!until || until.getTime() <= Date.now()) throw new Error(tr('Выберите время в будущем.','Choose a future time.'));
    await mutateThread({snoozedUntil:until.toISOString()}); closeSheet();
  }));
}

function openThreadOptions() {
  const box = mailbox(E.detail?.thread?.mailboxId);
  sheet(tr('Действия с перепиской','Conversation actions'),`<div class="cx-email-action-grid">
    ${button('assignment',tr('Назначить ответственного','Assign conversation'),disabled(!allowed('assign',box?.kind === 'shared' && box?.canManage)))}
    ${button('labels',tr('Метки','Labels'),disabled(!cap('canManageLabels') && !arr(E.boot?.labels).length))}
    ${button('waiting',tr('Ждём внешний ответ','Wait for an external reply'))}
    ${button('note-internal',tr('Командная заметка','Team note'))}${button('note-private',tr('Личная заметка','Private note'))}
    ${button('mailbox',tr('Настройки этого ящика','Mailbox settings'),disabled(!box?.canManage))}
  </div><p class="cx-email-caption">${tr('Назначение переписки распределяет обработку ящика. Оно не создаёт и не принимает задачу.','Conversation assignment distributes mailbox work. It does not create or accept a Task.')}</p>`,root => {
    root.querySelectorAll('[data-email-action]').forEach(node => { node.onclick = () => {
      const action = node.dataset.emailAction;
      if (action === 'assignment') openAssignment();
      if (action === 'labels') openThreadLabels();
      if (action === 'waiting') openWaiting();
      if (action === 'mailbox') openMailboxSettings(box.id);
      if (action.startsWith('note-')) { closeSheet(); openComposer(action === 'note-private' ? 'private' : 'internal'); }
    }; });
  });
}

function openAssignment() {
  sheet(tr('Ответственный за переписку','Conversation assignee'),`<form class="cx-email-form">${personField('assignedTo',tr('Кто обработает переписку','Who will handle this conversation'),E.detail?.thread?.assignedTo,{empty:true})}<p class="cx-email-caption">${tr('В списке только сотрудники. Доступ к общему ящику проверяется сервером.','Only employees are listed. The server verifies access to the shared mailbox.')}</p><button type="submit" class="cx-email-button is-primary">${tr('Назначить','Assign')}</button></form>`,root => bindForm(root.querySelector('form'),async data => {
    await mutateThread({assignedTo:data.get('assignedTo') || null}); closeSheet();
  }));
}

function openThreadLabels() {
  const existing = new Set(arr(E.detail?.thread?.labelIds).length ? E.detail.thread.labelIds : arr(E.detail?.thread?.labels).map(label => label.id));
  sheet(tr('Метки переписки','Conversation labels'),`<form class="cx-email-form"><div class="cx-email-checkbox-list">${arr(E.boot?.labels).map(label => `<label><input type="checkbox" name="labels" value="${esc(label.id)}" ${existing.has(label.id) ? 'checked' : ''}><span>${esc(label.name || label.label)}</span></label>`).join('') || `<p>${tr('Сначала создайте метку в настройках почты.','Create a label in email settings first.')}</p>`}</div><button type="submit" class="cx-email-button is-primary">${tr('Сохранить метки','Save labels')}</button></form>`,root => bindForm(root.querySelector('form'),async data => { await mutateThread({labelIds:data.getAll('labels')}); closeSheet(); }));
}

function openWaiting() {
  const external = [...arr(E.detail?.messages)].reverse().find(message => !outgoing(message));
  sheet(tr('Ждём внешний ответ','Waiting for an external reply'),`<form class="cx-email-form">${textField('title',tr('Какой ответ нужен','What response is needed'),{value:E.detail?.thread?.subject || '',required:true})}${textField('externalAddress',tr('От кого ждём','Whose response we need'),{type:'email',value:address(external?.from).address,required:true})}${personField('controllerId',tr('Сотрудник, который контролирует ответ','Employee monitoring the reply'))}${textField('dueAt',tr('Срок внешнего ответа','External reply due'),{type:'datetime-local',hint:tr('Отдельно от срока выполнения задачи.','Separate from the Task commitment date.')})}<p class="cx-email-notice">${tr('Запись отражает наше ожидание. Она не означает принятого внешним человеком обязательства.','This record describes our expectation. It does not mean the external person accepted a commitment.')}</p><button type="submit" class="cx-email-button is-primary">${tr('Зафиксировать ожидание','Create waiting item')}</button></form>`,root => bindForm(root.querySelector('form'),async data => {
    await api(`/threads/${idPath(E.selected)}/waiting`,{method:'POST',body:{title:data.get('title'),externalAddress:data.get('externalAddress'),controllerId:data.get('controllerId'),dueAt:data.get('dueAt') ? safeDate(data.get('dueAt'))?.toISOString() : null}});
    closeSheet(); await loadThread(E.selected,{keepComposer:true});
  }));
}

function resolveWaiting(id) {
  const messages = arr(E.detail?.messages).filter(message => !outgoing(message));
  sheet(tr('Зафиксировать внешний ответ','Record an external reply'),`<form class="cx-email-form"><label class="cx-email-field"><span>${tr('Письмо с ответом','Email containing the reply')}</span><select name="evidenceMessageId" required><option value="">${tr('Выберите письмо','Choose email')}</option>${messages.map(message => `<option value="${esc(message.id)}">${esc(`${dateText(message.receivedAt || message.sentAt)} · ${displayAddress(message.from)} · ${(message.text || '').slice(0,70)}`)}</option>`).join('')}</select></label><p class="cx-email-caption">${tr('Ответ зафиксирует сотрудник. Задача и её приёмка останутся в карточке задачи.','An employee records the reply. Task status and acceptance remain in the Task card.')}</p><button type="submit" class="cx-email-button is-primary">${tr('Ответ получен','Record reply')}</button></form>`,root => bindForm(root.querySelector('form'),async data => { await updateWaiting(id,'answered',data.get('evidenceMessageId')); closeSheet(); }));
}

async function updateWaiting(id, status, evidenceMessageId) {
  const item = arr(E.detail?.waiting).find(row => row.id === id); if (!item) return;
  await api(`/waiting/${idPath(id)}`,{method:'PATCH',body:{expectedVersion:item.version,status,...(evidenceMessageId ? {evidenceMessageId} : {})}});
  await loadThread(E.selected,{keepComposer:true});
}

function deleteNote(id) {
  const note = arr(E.detail?.notes).find(item => item.id === id); if (!note) return;
  sheet(tr('Удалить заметку?','Delete this note?'),`<p>${tr('Заметка исчезнет из переписки. Исходное письмо останется.','The note will be removed from the conversation. The original email remains.')}</p><form><button type="submit" class="cx-email-button is-danger">${tr('Удалить заметку','Delete note')}</button></form>`,root => bindForm(root.querySelector('form'),async () => {
    await api(`/notes/${idPath(id)}`,{method:'DELETE',body:{expectedVersion:note.version}}); closeSheet(); await loadThread(E.selected,{keepComposer:true});
  }));
}

async function resolveDraftConflict() {
  const compose = E.compose; if (!compose?.id) return;
  const result = await api(`/drafts/${idPath(compose.id)}`);
  const server = result.draft;
  sheet(tr('Две версии черновика','Two draft versions'),`<p>${tr('Выберите текст, с которым продолжите. Ни одна версия не будет отправлена автоматически.','Choose the version to continue editing. Neither version is sent automatically.')}</p><div class="cx-email-compare"><section><h3>${tr('Ваш текст в этой вкладке','Your text in this tab')}</h3><pre>${esc(compose.text)}</pre></section><section><h3>${tr('Версия на сервере','Server version')}</h3><pre>${esc(server.text)}</pre></section></div><div class="cx-email-actions">${button('use-server',tr('Продолжить с серверной','Use server version'))}${button('keep-local',tr('Сохранить мою версию поверх','Save my version over it'))}</div>`,root => {
    root.querySelector('[data-email-action="use-server"]').onclick = () => { E.compose = composeFromDraft(server); closeSheet(); render(); };
    root.querySelector('[data-email-action="keep-local"]').onclick = async () => {
      compose.version = server.version; compose.conflict = false; compose.dirty = true;
      try { await saveDraft({compose,notify:true}); closeSheet(); render(); } catch (error) { formError(root,error); }
    };
  },{wide:true});
}

async function uploadAttachments(files) {
  if (!cap('canAttachFiles') || !E.compose) return;
  const compose = E.compose;
  await saveDraft({compose});
  for (const file of files) {
    if (file.size > 10 * 1024 * 1024) throw new Error(tr(`Файл ${file.name} больше 10 МБ.`,`File ${file.name} exceeds 10 MB.`));
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = ''; for (let at = 0; at < bytes.length; at += 16384) binary += String.fromCharCode(...bytes.subarray(at,at + 16384));
    const result = await api(`/drafts/${idPath(compose.id)}/attachments`,{method:'POST',body:{name:file.name,mimeType:file.type || 'application/octet-stream',contentBase64:btoa(binary),expectedVersion:compose.version}});
    if (result.draft) { compose.version = result.draft.version; compose.attachments = arr(result.draft.attachments); }
    else if (result.attachment) { compose.attachments = [...arr(compose.attachments),result.attachment]; if (result.version) compose.version = result.version; }
    compose.dirty = true;
  }
  await saveDraft({compose}); render();
}

async function removeAttachment(id) {
  if (!E.compose) return;
  E.compose.attachments = arr(E.compose.attachments).filter(file => file.id !== id); E.compose.dirty = true;
  await saveDraft(); render();
}

function insertSignature() {
  captureComposer(); if (!E.compose || E.compose.mode !== 'external') return;
  const signature = mailbox(E.compose.mailboxId)?.signature || E.preferences?.signature;
  if (!signature) return;
  E.compose.text = `${E.compose.text.trimEnd()}\n\n${signature}`.trimStart(); E.compose.dirty = true;
  render(); saveDraft().catch(() => {});
}

async function prepareSend(schedule) {
  const compose = E.compose; if (!compose || compose.mode !== 'external') return;
  captureComposer();
  const payload = draftPayload(compose);
  if (!payload.to.length && !payload.cc.length && !payload.bcc.length) throw new Error(tr('Добавьте хотя бы одного получателя.','Add at least one recipient.'));
  if (!payload.subject.trim()) throw new Error(tr('Укажите тему письма.','Enter an email subject.'));
  if (!payload.text.trim() && !payload.attachments.length) throw new Error(tr('Введите текст или добавьте вложение.','Enter text or add an attachment.'));
  await saveDraft({compose});
  const box = mailbox(compose.mailboxId);
  const tomorrow = new Date(Date.now() + 3600000);
  sheet(schedule ? tr('Запланировать отправку','Schedule email') : tr('Отправить внешнее письмо','Send external email'),`<form class="cx-email-form"><dl class="cx-email-send-review"><dt>${tr('От','From')}</dt><dd>${esc(compose.fromAddress)}</dd><dt>${tr('Кому','To')}</dt><dd>${esc(compose.to || '—')}</dd>${compose.cc ? `<dt>Cc</dt><dd>${esc(compose.cc)}</dd>` : ''}${compose.bcc ? `<dt>Bcc</dt><dd>${esc(compose.bcc)}</dd>` : ''}<dt>${tr('Тема','Subject')}</dt><dd>${esc(compose.subject)}</dd><dt>${tr('Вложения','Attachments')}</dt><dd>${esc(arr(compose.attachments).map(file => file.filename || file.name).join(', ') || tr('Нет','None'))}</dd></dl>${schedule ? textField('scheduledAt',tr('Время отправки','Send time'),{type:'datetime-local',value:datetimeValue(tomorrow),required:true,hint:tr('Часовой пояс вашего устройства.','Your device’s time zone.')}) : ''}<p class="cx-email-notice">${box?.requireApproval ? tr('Общий ящик требует одобрения. Сервер проверит разрешение перед передачей письма провайдеру.','This shared mailbox requires approval. The server checks approval before handing the email to the provider.') : tr('Получатели увидят только это письмо и его вложения. Внутренние и личные заметки не добавляются.','Recipients see this email and its attachments. Team and private notes are excluded.')}</p><button type="submit" class="cx-email-button is-primary">${schedule ? tr('Поставить в расписание','Schedule send') : tr('Подтвердить отправку','Confirm send')}</button></form>`,root => bindForm(root.querySelector('form'),async data => {
    const scheduledAt = data.get('scheduledAt') ? safeDate(data.get('scheduledAt')) : null;
    if (schedule && (!scheduledAt || scheduledAt.getTime() <= Date.now())) throw new Error(tr('Выберите время в будущем.','Choose a future time.'));
    const commandKey = compose.sendCommandKey || key(); compose.sendCommandKey = commandKey;
    let result;
    try { result = await api(`/drafts/${idPath(compose.id)}/send-intents`,{method:'POST',idempotencyKey:commandKey,body:{expectedVersion:compose.version,commandKey,...(scheduledAt ? {scheduledAt:scheduledAt.toISOString()} : {})}}); }
    catch (error) { if (error.status === 0) { compose.sendUncertain = true; render(); } throw error; }
    if (!result.sendIntent?.id) throw new Error(tr('Сервер не подтвердил попытку отправки.','The server did not confirm a send attempt.'));
    const intent = {...result.sendIntent,threadId:result.sendIntent.threadId || compose.threadId,draftId:result.sendIntent.draftId || compose.id};
    E.intents.set(intent.id,intent); retainPendingNotes(compose); E.compose = null; persistRecovery();
    E.selected = null; E.detail = null; E.activeIntentId = intent.id; E.folder = 'outbox';
    closeSheet();
    await loadThreads();
    render(); pollIntents();
    E.bridge.toast?.(sendLabel(intent.state || intent.status));
  }));
}

async function checkSend(id) {
  if ((E.intents.get(id)?.state || E.intents.get(id)?.status) === 'unknown_outcome') {
    const reconciled = await api(`/send-intents/${idPath(id)}/reconcile`,{method:'POST',body:{}});
    if (reconciled.sendIntent?.id) { E.intents.set(id,{...E.intents.get(id),...reconciled.sendIntent}); render(); return reconciled.sendIntent; }
  }
  const result = await api(`/send-intents/${idPath(id)}`);
  const intent = result.sendIntent;
  if (intent?.id) { E.intents.set(intent.id,{...E.intents.get(intent.id),...intent}); render(); }
  return intent;
}

function pollIntents() {
  clearTimeout(E.sendTimer);
  if (!E.mounted) return;
  const pending = [...E.intents.values()].filter(intent => ['queued','dispatching'].includes(intent.state || intent.status));
  if (!pending.length) return;
  E.sendTimer = setTimeout(async () => {
    await Promise.allSettled(pending.map(intent => checkSend(intent.id)));
    pollIntents();
  },2500);
}

async function cancelSend(id) {
  const intent = E.intents.get(id); if (!intent) return;
  const result = await api(`/send-intents/${idPath(id)}/cancel`,{method:'POST',body:{expectedVersion:intent.version}});
  if (result.sendIntent) E.intents.set(id,result.sendIntent); render();
}

async function openSettings(tab = 'connections') {
  if (!E.boot) {
    try { E.boot = await api('/bootstrap'); E.bootAt = Date.now(); E.preferences = E.boot.preferences ?? {}; }
    catch (error) { report(error); return; }
  }
  const tabs = [['connections',tr('Ящики','Mailboxes')],['preferences',tr('Подпись и уведомления','Signature and notifications')],['templates',tr('Шаблоны','Templates')],['labels',tr('Метки','Labels')]];
  const content = ({connections:settingsConnections, preferences:settingsPreferences, templates:settingsTemplates, labels:settingsLabels})[tab] || settingsConnections;
  sheet(tr('Настройки почты','Email settings'),`<nav class="cx-email-settings-tabs">${tabs.map(([id,title]) => `<button type="button" data-email-setting-tab="${id}" aria-current="${tab === id ? 'page' : 'false'}">${title}</button>`).join('')}</nav>${content()}`,root => {
    root.querySelectorAll('[data-email-setting-tab]').forEach(node => { node.onclick = () => openSettings(node.dataset.emailSettingTab); });
    if (tab === 'connections') bindConnectionSettings(root);
    if (tab === 'preferences') bindPreferenceSettings(root);
    if (tab === 'templates') bindTemplateSettings(root);
    if (tab === 'labels') bindLabelSettings(root);
  },{wide:true,kind:'settings'});
}

function settingsConnections() {
  const providers = arr(E.boot?.providers);
  return `<div class="cx-email-connection-list">${arr(E.boot?.mailboxes).map(box => `<article data-email-mailbox-row="${esc(box.id)}"><div><strong>${esc(box.label || box.address)}</strong><p>${esc(box.address)} · ${box.kind === 'shared' ? tr('Общий ящик','Shared mailbox') : tr('Личный ящик','Personal mailbox')}</p></div>${badge(connectionLabel(box.connectionState),box.connectionState === 'connected' ? 'good' : 'waiting')}<div class="cx-email-actions">${button('mailbox-settings',tr('Настроить','Settings'),`data-email-mailbox-id="${esc(box.id)}"`)}${box.canSync ? button('sync-mailbox',tr('Синхронизировать','Synchronise'),`data-email-mailbox-id="${esc(box.id)}"`) : ''}${box.canImport || cap('canImport') ? button('import-mailbox',tr('Импорт .eml','.eml import'),`data-email-mailbox-id="${esc(box.id)}"`) : ''}</div>${mailboxSyncStatus(box)}</article>`).join('') || `<p>${tr('Почтовых ящиков пока нет.','No mailboxes yet.')}</p>`}</div>
    <section class="cx-email-setting-section"><h3>${tr('Добавить ящик','Add mailbox')}</h3><form class="cx-email-form" data-email-connection-form>
      <label class="cx-email-field"><span>${tr('Способ подключения','Connection type')}</span><select name="providerId" data-email-provider>${providers.map(provider => `<option value="${esc(provider.id)}" ${provider.configured === false && provider.id !== 'local' ? 'disabled' : ''}>${esc(provider.label || provider.name || provider.id)}${provider.configured === false && provider.id !== 'local' ? ` · ${tr('недоступен','unavailable')}` : ''}</option>`).join('')}</select></label>
      ${textField('label',tr('Название ящика','Mailbox label'),{required:true})}${textField('address',tr('Email-адрес','Email address'),{type:'email',required:true})}
      <label class="cx-email-field"><span>${tr('Доступ','Access')}</span><select name="kind"><option value="personal">${tr('Личный — только мне','Personal — only me')}</option><option value="shared">${tr('Общий — выбранной команде','Shared — selected team')}</option></select></label>
      <div class="cx-email-provider-fields" data-email-provider-config hidden><p class="cx-email-caption">${tr('Данные нужны для проверки IMAP и SMTP. Пароль не отображается после сохранения.','These details verify IMAP and SMTP. The password is not displayed after saving.')}</p>${textField('username',tr('Имя пользователя (обычно email)','Username (usually email)'))}${textField('password',tr('Пароль приложения','App password'),{type:'password'})}<div class="cx-email-form-grid"><section><h4>IMAP</h4>${textField('imapHost',tr('Сервер IMAP','IMAP server'))}${textField('imapPort',tr('Порт TLS','TLS port'),{type:'number',value:'993'})}</section><section><h4>SMTP</h4>${textField('smtpHost',tr('Сервер SMTP','SMTP server'))}${textField('smtpPort',tr('Порт TLS','TLS port'),{type:'number',value:'465'})}</section></div><p class="cx-email-caption">${tr('Используется защищённое TLS-подключение. Открытая передача пароля не включается.','A secure TLS connection is used. Clear-text password transmission is not enabled.')}</p></div>
      <p class="cx-email-provider-hint" data-email-provider-hint></p>
      <button type="submit" class="cx-email-button is-primary" ${disabled(!providers.some(provider => provider.configured !== false || provider.id === 'local'))}>${tr('Добавить и проверить','Add and verify')}</button>
    </form></section>`;
}

function bindConnectionSettings(root) {
  const form = root.querySelector('[data-email-connection-form]');
  const providerInput = form.elements.providerId;
  for (const [name,hint] of [['imapPort',tr('993 — TLS; 143 — обязательный STARTTLS.','993 — TLS; 143 — required STARTTLS.')],['smtpPort',tr('465 — TLS; 587 — обязательный STARTTLS.','465 — TLS; 587 — required STARTTLS.')]]) {
    const note = document.createElement('small'); note.textContent = hint;
    form.elements[name].closest('.cx-email-field').append(note);
  }
  const updateProvider = () => {
    const provider = arr(E.boot?.providers).find(item => item.id === providerInput.value);
    const credentials = providerInput.value !== 'local';
    form.querySelector('[data-email-provider-config]').hidden = !credentials;
    for (const name of ['password','imapHost','smtpHost']) form.elements[name].required = credentials;
    if (provider?.imap?.host) { form.elements.imapHost.value = provider.imap.host; form.elements.imapPort.value = provider.imap.port || 993; }
    if (provider?.smtp?.host) { form.elements.smtpHost.value = provider.smtp.host; form.elements.smtpPort.value = provider.smtp.port || 465; }
    form.querySelector('[data-email-provider-hint]').textContent = provider?.unavailableReason || (credentials ? tr('Подключение считается рабочим только после проверки сервером.','A connection is usable only after server verification.') : tr('Ручной импорт хранит настоящие .eml-файлы. Он не подключает внешний ящик и не включает отправку.','Manual import stores real .eml files. It does not connect an external mailbox or enable sending.'));
  };
  providerInput.onchange = updateProvider; updateProvider();
  bindForm(form,async data => {
    const providerId = data.get('providerId');
    const body = {providerId,label:data.get('label'),address:data.get('address'),kind:data.get('kind')};
    if (providerId !== 'local') body.config = {username:data.get('username') || data.get('address'),password:data.get('password'),imap:{host:data.get('imapHost'),port:Number(data.get('imapPort')),secure:Number(data.get('imapPort')) === 993},smtp:{host:data.get('smtpHost'),port:Number(data.get('smtpPort')),secure:Number(data.get('smtpPort')) === 465}};
    const result = await api('/api/v1/mailbox-connections',{method:'POST',body});
    form.elements.password.value = '';
    await reloadBootstrap(); openSettings('connections'); render();
    const box = result.mailbox || result.connection;
    E.bridge.toast?.(box ? connectionLabel(box.connectionState) : tr('Ящик добавлен; статус уточняется сервером.','Mailbox added; the server is checking its status.'));
  });
  root.querySelectorAll('[data-email-action="mailbox-settings"]').forEach(node => { node.onclick = () => openMailboxSettings(node.dataset.emailMailboxId); });
  root.querySelectorAll('[data-email-action="import-mailbox"]').forEach(node => { node.onclick = () => openImport(node.dataset.emailMailboxId); });
  root.querySelectorAll('[data-email-action="sync-mailbox"]').forEach(node => { node.onclick = async () => {
    node.disabled = true;
    try { await api(`/api/v1/mailbox-connections/${idPath(node.dataset.emailMailboxId)}/sync`,{method:'POST',body:{}}); await reloadBootstrap(); openSettings('connections'); await loadThreads(); }
    catch (error) { report(error); if (node.isConnected) node.disabled = false; }
  }; });
}

async function reloadBootstrap() {
  E.boot = await api('/bootstrap'); E.bootAt = Date.now(); E.preferences = E.boot.preferences ?? E.preferences; return E.boot;
}

async function openMailboxSettings(id) {
  try {
    const result = await api(`/api/v1/mailbox-connections/${idPath(id)}`);
    const box = result.mailbox;
    const members = arr(result.members);
    sheet(box.label || box.address,`<p>${esc(box.address)} · ${badge(connectionLabel(box.connectionState))}</p>${mailboxSyncStatus(box)}
      ${box.canManage ? `<form class="cx-email-form" data-email-mailbox-form>${textField('label',tr('Название','Label'),{value:box.label,required:true})}${textField('signature',tr('Подпись ящика','Mailbox signature'),{value:box.signature || '',textarea:true})}${box.kind === 'shared' ? `<label class="cx-email-check"><input type="checkbox" name="requireApproval" ${box.requireApproval ? 'checked' : ''}><span>${tr('Отправка только после одобрения версии черновика','Require approval of the draft version before sending')}</span></label>` : ''}<label class="cx-email-check"><input type="checkbox" name="paused" ${box.connectionState === 'paused' || box.paused ? 'checked' : ''}><span>${tr('Приостановить синхронизацию','Pause synchronisation')}</span></label><button type="submit" class="cx-email-button is-primary">${tr('Сохранить настройки','Save settings')}</button></form>` : `<p>${tr('Настройки доступны управляющему этим ящиком.','These settings are available to the mailbox manager.')}</p>`}
      ${box.kind === 'shared' ? `<section class="cx-email-setting-section"><h3>${tr('Доступ команды','Team access')}</h3><p class="cx-email-caption">${tr('Читатель видит переписку; отвечающий готовит и отправляет письма; управляющий меняет доступ и правила. Сервер проверяет каждое действие.','Readers see conversations; responders draft and send email; managers control access and policies. The server authorises every action.')}</p><div class="cx-email-member-list">${members.map(member => `<div><span>${esc(member.displayName || personName(member.userId))}</span>${badge(({reader:tr('Читатель','Reader'),responder:tr('Отвечающий','Responder'),manager:tr('Управляющий','Manager')})[member.role] || member.role)}${box.canManageMembers ? button('remove-member',tr('Убрать доступ','Remove access'),`data-email-member-id="${esc(member.userId)}"`) : ''}</div>`).join('')}</div>${box.canManageMembers ? `<form class="cx-email-form" data-email-member-form>${personField('userId',tr('Сотрудник','Employee'))}<label class="cx-email-field"><span>${tr('Роль','Role')}</span><select name="role"><option value="reader">${tr('Читатель','Reader')}</option><option value="responder">${tr('Отвечающий','Responder')}</option><option value="manager">${tr('Управляющий','Manager')}</option></select></label><button type="submit" class="cx-email-button">${tr('Предоставить доступ','Grant access')}</button></form>` : ''}</section>` : ''}
      ${box.canManage ? `<div class="cx-email-actions cx-email-setting-section">${button('disconnect-mailbox',tr('Отключить провайдера','Disconnect provider'))}${button('rules',tr('Правила обработки','Processing rules'),disabled(!cap('canManageRules')))}</div>` : ''}`,root => {
      const form = root.querySelector('[data-email-mailbox-form]');
      if (form) bindForm(form,async data => {
        await api(`/api/v1/mailbox-connections/${idPath(id)}`,{method:'PATCH',body:{expectedVersion:box.version,label:data.get('label'),signature:data.get('signature'),paused:data.has('paused'),...(box.kind === 'shared' ? {requireApproval:data.has('requireApproval')} : {})}});
        await reloadBootstrap(); render(); await openMailboxSettings(id);
      });
      const memberForm = root.querySelector('[data-email-member-form]');
      if (memberForm) bindForm(memberForm,async data => { await api(`/api/v1/mailbox-connections/${idPath(id)}/members`,{method:'POST',body:{userId:data.get('userId'),role:data.get('role')}}); await openMailboxSettings(id); });
      root.querySelectorAll('[data-email-action="remove-member"]').forEach(node => { node.onclick = async () => {
        node.disabled = true;
        try { await api(`/api/v1/mailbox-connections/${idPath(id)}/members/${idPath(node.dataset.emailMemberId)}`,{method:'DELETE'}); await openMailboxSettings(id); }
        catch (error) { report(error); node.disabled = false; }
      }; });
      root.querySelector('[data-email-action="disconnect-mailbox"]')?.addEventListener('click',() => {
        sheet(tr('Отключить провайдера?','Disconnect this provider?'),`<p>${tr('Новая почта перестанет поступать, отправка станет недоступна. Сохранённая история останется в ящике.','New email will stop syncing and sending will become unavailable. Saved history remains in the mailbox.')}</p><form><button type="submit" class="cx-email-button is-danger">${tr('Отключить','Disconnect')}</button></form>`,body => bindForm(body.querySelector('form'),async () => {
          await api(`/api/v1/mailbox-connections/${idPath(id)}/disconnect`,{method:'POST',body:{expectedVersion:box.version}}); await reloadBootstrap(); render(); openSettings('connections');
        }));
      });
      root.querySelector('[data-email-action="rules"]')?.addEventListener('click',() => openRules(id));
    },{wide:true});
  } catch (error) { report(error); }
}

function settingsPreferences() {
  const prefs = E.preferences || {};
  const notifications = prefs.notifications || {};
  return `<form class="cx-email-form" data-email-preferences-form>
    <fieldset class="cx-email-notification-settings" data-email-notification-settings>
      <legend>${tr('Уведомления о почте','Email notifications')}</legend>
      <label class="cx-email-check"><input type="checkbox" name="notificationsEnabled" aria-describedby="cx-email-notification-scope" ${notifications.enabled !== false ? 'checked' : ''}><span>${tr('Получать уведомления о почте в ChatX','Receive email notifications in ChatX')}</span></label>
      <p class="cx-email-caption" id="cx-email-notification-scope">${tr('Для вас в этом рабочем пространстве. Изменения действуют после сохранения; уже полученные уведомления останутся в списке.','For you in this workspace. Changes take effect after saving; existing notifications stay in your inbox.')}</p>
      <div class="cx-email-notification-options" data-email-notification-options>
        <label class="cx-email-field"><span>${tr('Новые письма в общих ящиках','New email in shared mailboxes')}</span><select name="notificationsFocus" aria-describedby="cx-email-notification-focus-hint"><option value="all" ${notifications.focus !== 'assigned' ? 'selected' : ''}>${tr('Во всех доступных мне переписках','In all conversations I can access')}</option><option value="assigned" ${notifications.focus === 'assigned' ? 'selected' : ''}>${tr('Только в назначенных мне','Only in conversations assigned to me')}</option></select></label>
        <p class="cx-email-caption" id="cx-email-notification-focus-hint">${tr('Фильтр относится к новым письмам в общих ящиках. Личные письма и выбранные уведомления о назначениях, сроках и отправке приходят независимо от него.','This filter applies to new email in shared mailboxes. Personal email and the selected assignment, due-date and sending notifications are unaffected.')}</p>
        <div class="cx-email-checkbox-list" role="group" aria-label="${esc(tr('Типы уведомлений','Notification types'))}">${[['reply',tr('Новое входящее письмо','New incoming email')],['assignment',tr('Мне назначили переписку','Conversation assigned to me')],['waiting',tr('Подошёл срок внешнего ответа','External reply is due')],['sendFailure',tr('Ошибка или неопределённость отправки','Send failure or unknown outcome')]].map(([id,title]) => `<label class="cx-email-check"><input type="checkbox" name="${id}" ${notifications[id] !== false ? 'checked' : ''}><span>${title}</span></label>`).join('')}</div>
      </div>
      <p class="cx-email-caption" data-email-notifications-paused ${notifications.enabled !== false ? 'hidden' : ''}>${tr('Новые уведомления о почте будут выключены. Выбранные типы и фильтр сохранятся.','New email notifications will be turned off. Your selected types and filter will be kept.')}</p>
    </fieldset>
    ${textField('signature',tr('Личная подпись','Personal signature'),{value:prefs.signature || '',textarea:true,hint:tr('Добавляется в письмо только вашей командой «Подпись».','Inserted only when you choose Signature.')})}
    <label class="cx-email-field"><span>${tr('Язык интерфейса','Interface language')}</span><select name="language"><option value="ru" ${window.ChatPreferences?.locale !== 'en' ? 'selected' : ''}>Русский</option><option value="en" ${window.ChatPreferences?.locale === 'en' ? 'selected' : ''}>English</option></select></label>
    <label class="cx-email-check"><input type="checkbox" name="localRecovery" ${recoveryEnabled() ? 'checked' : ''}><span>${tr('Сохранять незавершённые письма на этом устройстве до 24 часов','Keep unfinished email on this device for up to 24 hours')}</span></label><p class="cx-email-caption">${tr('По умолчанию письма и черновики находятся только в памяти открытой вкладки. При включении восстановления на устройстве сохраняются текст черновика и адресаты. Выход из аккаунта удаляет локальную копию; восстановление никогда не отправляет письмо.','By default, email and unfinished drafts remain only in the open tab’s memory. Recovery stores draft text and recipients on this device. Signing out removes the local copy; recovery never sends email.')}</p><button type="submit" class="cx-email-button is-primary">${tr('Сохранить','Save')}</button></form>`;
}

function bindPreferenceSettings(root) {
  const form = root.querySelector('[data-email-preferences-form]');
  const syncNotificationControls = () => {
    const enabled = form.elements.notificationsEnabled.checked;
    form.querySelectorAll('[data-email-notification-options] input, [data-email-notification-options] select').forEach(control => { control.disabled = !enabled; });
    form.querySelector('[data-email-notifications-paused]').hidden = enabled;
    form.querySelector('[data-email-notification-options]').classList.toggle('is-paused',!enabled);
  };
  form.elements.notificationsEnabled.addEventListener('change',syncNotificationControls);
  syncNotificationControls();
  bindForm(form,async data => {
    // Disabled controls are omitted by FormData. Read their retained values so
    // muting email never clears the user's selected types or shared-mail filter.
    const notifications = {...Object.fromEntries(['reply','assignment','waiting','sendFailure'].map(name => [name,form.elements[name].checked])),enabled:form.elements.notificationsEnabled.checked,focus:form.elements.notificationsFocus.value};
    const preferences = {signature:data.get('signature'),language:data.get('language'),notifications};
    const result = await api('/preferences',{method:'PUT',body:preferences});
    E.preferences = result.preferences || preferences;
    setRecoveryEnabled(data.has('localRecovery'));
    window.ChatPreferences?.setLocale?.(data.get('language'));
    E.bridge.toast?.(tr('Настройки сохранены','Settings saved')); openSettings('preferences'); render();
  });
}

function settingsTemplates() {
  return `<p class="cx-email-caption">${tr('Шаблон заполняет черновик. Он не выбирает получателей и не отправляет письмо. RU/EN/ES/IT — языки содержимого шаблона.','A template fills a draft. It neither selects recipients nor sends email. RU/EN/ES/IT are template content languages.')}</p><div class="cx-email-template-list">${arr(E.boot?.templates).map(template => `<article><div><strong>${esc(template.name || template.title)}</strong>${badge(String(template.language || 'ru').toUpperCase())}${badge(template.scope === 'shared' ? tr('Общий','Shared') : tr('Личный','Personal'))}</div><p>${esc(template.subject || '')}</p><div class="cx-email-actions">${button('edit-template',tr('Изменить','Edit'),`data-email-template-id="${esc(template.id)}"`, '')}${button('delete-template',tr('Удалить','Delete'),`data-email-template-id="${esc(template.id)}"`)}</div></article>`).join('') || `<p>${tr('Шаблонов пока нет.','No templates yet.')}</p>`}</div>${button('new-template',tr('Добавить шаблон','Add template'),disabled(!cap('canManageTemplates')),'is-primary')}`;
}

function bindTemplateSettings(root) {
  root.querySelector('[data-email-action="new-template"]')?.addEventListener('click',() => editTemplate());
  root.querySelectorAll('[data-email-action="edit-template"]').forEach(node => { node.onclick = () => editTemplate(arr(E.boot.templates).find(template => template.id === node.dataset.emailTemplateId)); });
  root.querySelectorAll('[data-email-action="delete-template"]').forEach(node => { node.onclick = async () => {
    const template = arr(E.boot.templates).find(item => item.id === node.dataset.emailTemplateId); if (!template) return;
    try { await api(`/templates/${idPath(template.id)}`,{method:'DELETE',body:{expectedVersion:template.version}}); await reloadBootstrap(); openSettings('templates'); }
    catch (error) { report(error); }
  }; });
}

function editTemplate(template = null) {
  sheet(template ? tr('Изменить шаблон','Edit template') : tr('Новый шаблон','New template'),`<form class="cx-email-form">${textField('name',tr('Название шаблона','Template name'),{value:template?.name || '',required:true})}<div class="cx-email-form-grid"><label class="cx-email-field"><span>${tr('Язык текста','Content language')}</span><select name="language">${['ru','en','es','it'].map(code => `<option value="${code}" ${code === (template?.language || window.ChatPreferences?.locale || 'ru') ? 'selected' : ''}>${code.toUpperCase()}</option>`).join('')}</select></label><label class="cx-email-field"><span>${tr('Доступ','Access')}</span><select name="scope"><option value="personal">${tr('Личный','Personal')}</option><option value="shared" ${template?.scope === 'shared' ? 'selected' : ''}>${tr('Общий','Shared')}</option></select></label></div>${textField('subject',tr('Тема письма','Email subject'),{value:template?.subject || ''})}${textField('text',tr('Текст','Text'),{value:template?.text || '',textarea:true,required:true})}<button type="submit" class="cx-email-button is-primary">${tr('Сохранить шаблон','Save template')}</button></form>`,root => bindForm(root.querySelector('form'),async data => {
    await api(template ? `/templates/${idPath(template.id)}` : '/templates',{method:template ? 'PATCH' : 'POST',body:{...Object.fromEntries(data),...(template ? {expectedVersion:template.version} : {})}});
    await reloadBootstrap(); openSettings('templates');
  }));
}

function openTemplatePicker() {
  captureComposer();
  sheet(tr('Вставить шаблон','Insert a template'),`<p class="cx-email-caption">${tr('Текст добавится в конец текущего черновика. Адресаты останутся прежними.','The text is appended to this draft. Recipients remain unchanged.')}</p><div class="cx-email-template-list">${arr(E.boot?.templates).map(template => `<button type="button" class="cx-email-template-option" data-email-use-template="${esc(template.id)}"><strong>${esc(template.name || template.title)}</strong><span>${esc(String(template.language || 'ru').toUpperCase())} · ${esc(template.subject || '')}</span><p>${esc((template.text || '').slice(0,180))}</p></button>`).join('')}</div>`,root => {
    root.querySelectorAll('[data-email-use-template]').forEach(node => { node.onclick = () => {
      const template = arr(E.boot?.templates).find(item => item.id === node.dataset.emailUseTemplate);
      if (!template || !E.compose) return;
      E.compose.text = `${E.compose.text.trimEnd()}\n\n${template.text}`.trimStart();
      if (!E.compose.subject.trim()) E.compose.subject = template.subject || '';
      E.compose.dirty = true; closeSheet(); render(); saveDraft().catch(() => {});
    }; });
  });
}

function settingsLabels() {
  return `<div class="cx-email-label-list">${arr(E.boot?.labels).map(label => `<div><span>${esc(label.name || label.label)}</span>${button('delete-label',tr('Удалить','Delete'),`data-email-label-id="${esc(label.id)}" ${disabled(!cap('canManageLabels'))}`)}</div>`).join('')}</div><form class="cx-email-form" data-email-label-form>${textField('name',tr('Новая метка','New label'),{required:true})}<button type="submit" class="cx-email-button is-primary" ${disabled(!cap('canManageLabels'))}>${tr('Добавить метку','Add label')}</button></form>`;
}

function bindLabelSettings(root) {
  bindForm(root.querySelector('[data-email-label-form]'),async data => { await api('/labels',{method:'POST',body:{name:data.get('name'),color:'neutral'}}); await reloadBootstrap(); openSettings('labels'); render(); });
  root.querySelectorAll('[data-email-action="delete-label"]').forEach(node => { node.onclick = async () => {
    const label = arr(E.boot?.labels).find(item => item.id === node.dataset.emailLabelId); if (!label) return;
    try { await api(`/labels/${idPath(label.id)}`,{method:'DELETE',body:{expectedVersion:label.version}}); await reloadBootstrap(); openSettings('labels'); }
    catch (error) { report(error); }
  }; });
}

function openImport(preferredMailbox) {
  const boxes = arr(E.boot?.mailboxes).filter(box => box.canImport !== false && (box.canManage !== false || box.kind === 'personal'));
  sheet(tr('Импортировать исходное письмо','Import an original email'),`<form class="cx-email-form"><p>${tr('Загрузите .eml-файл. Импорт сохраняет источник и не создаёт внешнего подключения.','Upload an .eml file. Import keeps the source and does not create an external connection.')}</p><label class="cx-email-field"><span>${tr('В какой ящик','Destination mailbox')}</span><select name="mailboxId" required>${boxes.map(box => `<option value="${esc(box.id)}" ${box.id === (preferredMailbox || E.mailboxId) ? 'selected' : ''}>${esc(box.label || box.address)} · ${box.kind === 'shared' ? tr('общий','shared') : tr('личный','personal')}</option>`).join('')}</select></label><label class="cx-email-field"><span>${tr('Исходное письмо .eml','Original .eml email')}</span><input type="file" name="eml" accept=".eml,message/rfc822" required></label><p class="cx-email-caption">${tr('Письмо будет видно участникам выбранного ящика. Вложения остаются внутри почтовой области доступа.','The email becomes visible to participants of the selected mailbox. Attachments remain within email access controls.')}</p><button type="submit" class="cx-email-button is-primary" ${disabled(!boxes.length)}>${tr('Импортировать','Import')}</button></form>`,root => bindForm(root.querySelector('form'),async data => {
    const file = data.get('eml');
    if (!(file instanceof File) || !file.size) throw new Error(tr('Выберите .eml-файл.','Choose an .eml file.'));
    if (file.size > 15 * 1024 * 1024) throw new Error(tr('Письмо больше 15 МБ.','The email exceeds 15 MB.'));
    const commandKey = key();
    const result = await api(`/api/v1/mailbox-connections/${idPath(data.get('mailboxId'))}/import`,{method:'POST',idempotencyKey:commandKey,body:{raw:await file.text(),commandKey}});
    closeSheet(); E.mailboxId = data.get('mailboxId'); E.folder = 'inbox'; await reloadBootstrap(); await loadThreads();
    if (result.thread?.id) await openThread(result.thread.id);
    E.bridge.toast?.(tr('Письмо импортировано','Email imported'));
  }));
}

function canResource(kind) {
  return allowed('reply',true) && (kind === 'task' ? cap('canCreateTask') || cap('canLinkTask') : cap(`canCreate${kind[0].toUpperCase()}${kind.slice(1)}`) || cap(`canLink${kind[0].toUpperCase()}${kind.slice(1)}`) || (kind === 'decision' && cap('canProposeDecision')));
}

function openMessageActions(messageId) {
  const message = arr(E.detail?.messages).find(item => item.id === messageId); if (!message) return;
  const resources = [['task',tr('Задача','Task')],['event',tr('Встреча','Meeting')],['page',tr('Страница','Page')],['decision',tr('Решение','Decision')]];
  sheet(tr('Связать письмо с работой','Link email to work'),`<p class="cx-email-caption">${tr('Источник остаётся письмом. У нового рабочего объекта будет собственная аудитория и история.','The source remains an email. The work item has its own audience and history.')}</p><div class="cx-email-resource-grid">${resources.map(([kind,title]) => `<section><h3>${title}</h3>${button('create-resource',tr('Создать','Create'),`data-email-kind="${kind}" ${disabled(!canResource(kind))}`)}${button('link-resource',tr('Связать существующий','Link existing'),`data-email-kind="${kind}" ${disabled(!canResource(kind))}`)}${!canResource(kind) ? `<p>${tr('Недоступно для этого ящика или роли.','Unavailable for this mailbox or role.')}</p>` : ''}</section>`).join('')}</div><div class="cx-email-actions">${button('assistant',tr('Помощник','Assistant'),disabled(!cap('canUseAssistant')))}${button('booking',tr('Предложить время встречи','Offer meeting times'),disabled(!cap('canCreateBookingLink')))}</div>`,root => {
    root.querySelectorAll('[data-email-action="create-resource"]').forEach(node => { node.onclick = () => openResourceCreate(node.dataset.emailKind,message); });
    root.querySelectorAll('[data-email-action="link-resource"]').forEach(node => { node.onclick = () => openResourcePicker(node.dataset.emailKind,message); });
    root.querySelector('[data-email-action="assistant"]')?.addEventListener('click',() => openAssistant());
    root.querySelector('[data-email-action="booking"]')?.addEventListener('click',() => openBooking(message));
  },{wide:true});
}

function openResourceCreate(kind, message) {
  const title = E.detail?.thread?.subject || message.subject || '';
  const excerpt = (message.text || '').slice(0,8000);
  let fields = textField('title',tr('Название','Title'),{value:title,required:true});
  let disclosure = '';
  if (kind === 'task') {
    fields += textField('outcome',tr('Ожидаемый результат','Expected outcome'),{value:excerpt,textarea:true,required:true}) + personField('ownerId',tr('Ответственный сотрудник','Accountable employee')) + personField('acceptorId',tr('Кто принимает результат','Who accepts the result')) + textField('promisedAt',tr('Обещанный срок задачи','Task commitment date'),{type:'datetime-local'}) + textField('forecastAt',tr('Текущий прогноз','Current forecast'),{type:'datetime-local',hint:tr('Прогноз не заменяет обещанный срок.','The forecast does not replace the commitment date.')});
    disclosure = tr('Название и ожидаемый результат будут доступны ответственному, принимающему и управляющим, которым разрешён доступ к задаче. Внешний адресат не становится исполнителем или принимающим.','The title and outcome will be visible to the owner, acceptor and managers authorised to access the Task. The external correspondent does not become its owner or acceptor.');
  } else if (kind === 'event') {
    const start = new Date(Date.now() + 86400000); start.setMinutes(0,0,0); const end = new Date(start.getTime() + 1800000);
    fields += `<div class="cx-email-form-grid">${textField('startAt',tr('Начало','Start'),{type:'datetime-local',value:datetimeValue(start),required:true})}${textField('endAt',tr('Окончание','End'),{type:'datetime-local',value:datetimeValue(end),required:true})}</div>` + textField('timezone',tr('Часовой пояс','Time zone'),{value:Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',required:true}) + personField('participantIds',tr('Участники из команды','Team participants'),null,{multiple:true}) + textField('description',tr('Повестка и описание','Agenda and description'),{value:excerpt,textarea:true}) + `<p class="cx-email-notice" data-email-availability>${tr('Доступность участников неизвестна. Отсутствие видимых конфликтов не означает свободное время всех участников.','Participant availability is unknown. No visible conflicts does not mean every participant is free.')}</p>${button('check-availability',tr('Проверить мой календарь','Check my calendar'))}`;
    disclosure = tr('Название, время и повестка появятся в календаре выбранных участников. Письмо не рассылается внешним адресатам автоматически.','The title, time and agenda appear in the selected participants’ calendars. Email is not automatically sent to external correspondents.');
  } else if (kind === 'page') {
    fields += textField('content',tr('Содержимое страницы','Page content'),{value:excerpt,textarea:true});
    disclosure = tr('Страница создаётся с ограниченным доступом только автору. Вы сможете открыть карточку и явно расширить доступ. Исходное письмо не становится публичным.','The Page is created with access restricted to its author. Open its card to share it explicitly. The source email does not become public.');
  } else {
    fields += textField('body',tr('Формулировка решения','Decision text'),{value:excerpt,textarea:true,required:true}) + `<label class="cx-email-check"><input type="checkbox" name="accepted" required><span>${tr('Я явно принимаю это решение. Письмо само по себе не означает принятия.','I explicitly accept this decision. The email itself does not mean acceptance.')}</span></label>`;
    disclosure = tr('Формулировка решения будет доступна читателям исходного ящика. Принятие фиксируется вашим действием, с сохранением ссылки на источник.','The decision text is available to readers of the source mailbox. Acceptance is recorded as your action, with a source reference.');
  }
  const label = ({task:tr('Создать задачу','Create Task'),event:tr('Создать встречу','Create meeting'),page:tr('Создать страницу','Create Page'),decision:tr('Принять решение','Accept decision')})[kind];
  sheet(label,`<form class="cx-email-form" data-email-resource-form>${fields}<section class="cx-email-disclosure"><h3>${tr('Кто увидит скопированный текст','Who will see the copied text')}</h3><p>${disclosure}</p><label class="cx-email-check"><input type="checkbox" name="confirmDisclosure" required><span>${tr('Подтверждаю создание с указанной аудиторией.','I confirm creation with this audience.')}</span></label></section><button type="submit" class="cx-email-button is-primary">${label}</button></form>`,root => {
    const form = root.querySelector('form');
    bindForm(form,async data => {
      const input = {title:data.get('title'),confirmDisclosure:data.has('confirmDisclosure')};
      if (kind === 'task') Object.assign(input,{outcome:data.get('outcome'),ownerId:data.get('ownerId'),acceptorId:data.get('acceptorId'),...(data.get('promisedAt') ? {promisedAt:safeDate(data.get('promisedAt'))?.toISOString()} : {}),...(data.get('forecastAt') ? {forecastAt:safeDate(data.get('forecastAt'))?.toISOString()} : {})});
      if (kind === 'event') {
        const startAt = safeDate(data.get('startAt')), endAt = safeDate(data.get('endAt'));
        if (!startAt || !endAt || endAt <= startAt) throw new Error(tr('Окончание должно быть позже начала.','The end must be after the start.'));
        Object.assign(input,{startAt:startAt.toISOString(),endAt:endAt.toISOString(),timezone:data.get('timezone'),participantIds:data.getAll('participantIds'),description:data.get('description')});
      }
      if (kind === 'page') input.content = data.get('content');
      if (kind === 'decision') Object.assign(input,{body:data.get('body'),accepted:data.has('accepted')});
      const result = await api(`/messages/${idPath(message.id)}/resource-links`,{method:'POST',body:{kind,input}});
      const resourceId = result.resource?.id || result.link?.resourceId || result.link?.[`${kind}Id`];
      closeSheet('navigate'); await loadThread(E.selected,{keepComposer:true});
      if (resourceId) await openCanonical(kind,resourceId);
    });
    root.querySelector('[data-email-action="check-availability"]')?.addEventListener('click',async event => {
      event.target.disabled = true;
      const status = root.querySelector('[data-email-availability]');
      try {
        const startAt = safeDate(form.elements.startAt.value), endAt = safeDate(form.elements.endAt.value);
        if (!startAt || !endAt || endAt <= startAt) throw new Error(tr('Проверьте начало и окончание.','Check the start and end.'));
        const result = await api(`/api/v1/calendar-conflicts?${new URLSearchParams({startAt:startAt.toISOString(),endAt:endAt.toISOString()})}`);
        status.textContent = arr(result.items).length ? tr(`Видимые конфликты: ${result.items.length}. Проверьте календарь.`,`Visible conflicts: ${result.items.length}. Review your calendar.`) : tr('В вашем доступном календаре конфликтов не найдено. Доступность остальных участников неизвестна.','No conflicts found in your accessible calendar. Other participants’ availability is unknown.');
      } catch (error) { status.textContent = tr('Доступность неизвестна. ','Availability unknown. ') + error.message; }
      finally { event.target.disabled = false; }
    });
  },{wide:true});
}

async function openResourcePicker(kind, message) {
  const sources = {task:'/api/v1/tasks?limit=50',event:'/api/v1/calendar-events',page:'/api/v1/wiki/pages',decision:'/api/v1/meetings/decisions?limit=50'};
  try {
    const result = await api(sources[kind]);
    const items = Array.isArray(result) ? result : arr(result.items ?? result.pages ?? result.events ?? result.decisions);
    sheet(tr('Связать существующий объект','Link an existing item'),`<p>${tr('Письмо останется в своём ящике. Связь не копирует текст и не расширяет доступ к объекту.','The email stays in its mailbox. A link neither copies the text nor expands access to the item.')}</p><label class="cx-email-field"><span>${tr('Найти в доступной выборке','Find in the accessible selection')}</span><input type="search" data-email-resource-search></label><div class="cx-email-resource-picker">${items.map(item => `<button type="button" class="cx-email-resource-option" data-email-resource-id="${esc(item.id)}" data-email-search-title="${esc(String(item.title || item.name || '').toLowerCase())}"><strong>${esc(item.title || item.name || item.id)}</strong><small>${esc(item.status || '')}${item.version ? ` · ${tr('версия','version')} ${esc(item.version)}` : ''}${kind === 'page' ? ` · ${esc(item.visibility || item.access || tr('по правам страницы','Page access rules'))}` : ''}</small></button>`).join('') || `<p>${tr('Доступных объектов в этой выборке нет.','No accessible items in this selection.')}</p>`}</div>`,root => {
      root.querySelector('[data-email-resource-search]').oninput = event => { const q = event.target.value.trim().toLowerCase(); root.querySelectorAll('[data-email-resource-id]').forEach(node => { node.hidden = !node.dataset.emailSearchTitle.includes(q); }); };
      root.querySelectorAll('[data-email-resource-id]').forEach(node => { node.onclick = async () => {
        node.disabled = true;
        try { await api(`/messages/${idPath(message.id)}/resource-links`,{method:'POST',body:{kind,input:{resourceId:node.dataset.emailResourceId}}}); closeSheet(); await loadThread(E.selected,{keepComposer:true}); }
        catch (error) { formError(root,error); node.disabled = false; }
      }; });
    });
  } catch (error) { report(error); }
}

async function openCanonical(kind, id) {
  const callback = ({task:E.bridge.openTask,event:E.bridge.openEvent,page:E.bridge.openWikiPage,decision:E.bridge.openDecision})[kind];
  if (!callback || !id) { E.bridge.toast?.(tr('Карточка пока недоступна.','The item card is unavailable.')); return; }
  captureComposer(); closeSheet('navigate');
  await callback(id);
}

async function approveDraft() {
  const compose = await saveDraft(); if (!compose?.id) return;
  sheet(tr('Одобрить версию черновика','Approve this draft version'),`<p>${tr('Одобрение относится к текущим получателям, тексту и вложениям. Изменения после одобрения потребуют новой проверки.','Approval covers the current recipients, text and attachments. Later changes require a new review.')}</p><dl class="cx-email-send-review"><dt>${tr('Кому','To')}</dt><dd>${esc(compose.to)}</dd><dt>Cc / Bcc</dt><dd>${esc([compose.cc,compose.bcc].filter(Boolean).join(' / ') || '—')}</dd><dt>${tr('Тема','Subject')}</dt><dd>${esc(compose.subject)}</dd></dl><div class="cx-email-result-text">${esc(compose.text)}</div><form><button type="submit" class="cx-email-button is-primary">${tr('Одобрить эту версию','Approve this version')}</button></form>`,root => bindForm(root.querySelector('form'),async () => {
    const result = await api(`/drafts/${idPath(compose.id)}/approve`,{method:'POST',body:{expectedVersion:compose.version}});
    if (result.draft) Object.assign(compose,{version:result.draft.version,approvedVersion:result.draft.approvedVersion,approvedBy:result.draft.approvedBy,approvedAt:result.draft.approvedAt});
    closeSheet(); E.bridge.toast?.(tr('Версия черновика одобрена','Draft version approved')); render();
  }));
}

function storageKey(part) { return E.sessionKey ? `chatx:email:${part}:${E.sessionKey}` : null; }
function recoveryEnabled() { try { const name = storageKey('recovery-opt-in'); return Boolean(name && localStorage.getItem(name) === 'true'); } catch { return false; } }
function setRecoveryEnabled(enabled) {
  const name = storageKey('recovery-opt-in'); if (!name) return;
  if (enabled) { localStorage.setItem(name,'true'); persistRecovery(); }
  else { localStorage.removeItem(name); clearRecovery(); }
}
function clearRecovery(consent = false) {
  try { const name = storageKey('draft-recovery'); if (name) localStorage.removeItem(name); if (consent && storageKey('recovery-opt-in')) localStorage.removeItem(storageKey('recovery-opt-in')); } catch {}
  E.recoverable = [];
}
function persistRecovery() {
  if (!recoveryEnabled()) return;
  const candidates = [...E.composers.values()].flatMap(compose => compose.mode === 'external' ? [compose] : compose.priorModes?.external ? [compose.priorModes.external] : []);
  const drafts = [...new Map(candidates.map(compose => [compose.localKey,compose])).values()].filter(compose => compose.text?.trim() || compose.to?.trim() || compose.subject?.trim()).map(compose => {
    const data = {};
    for (const field of ['id','localKey','mode','mailboxId','threadId','replyToMessageId','fromAddress','to','cc','bcc','subject','text','version','showCc']) if (compose[field] !== undefined) data[field] = compose[field];
    data.attachments = arr(compose.attachments).map(file => ({id:file.id,name:file.name,filename:file.filename}));
    return data;
  });
  try {
    const name = storageKey('draft-recovery');
    if (drafts.length) localStorage.setItem(name,JSON.stringify({version:1,sessionKey:E.sessionKey,expiresAt:Date.now() + 86400000,drafts}));
    else localStorage.removeItem(name);
  } catch { E.bridge.toast?.(tr('Не удалось сохранить локальную копию черновика.','The local recovery copy could not be saved.')); }
}
function loadRecovery() {
  E.recoveryLoaded = true; E.recoverable = [];
  if (!recoveryEnabled()) return;
  try {
    const value = JSON.parse(localStorage.getItem(storageKey('draft-recovery')) || 'null');
    if (!value || value.version !== 1 || value.sessionKey !== E.sessionKey || value.expiresAt <= Date.now()) { clearRecovery(); return; }
    E.recoverable = arr(value.drafts);
  } catch { clearRecovery(); }
}
function renderRecovery() {
  const count = arr(E.recoverable).filter(compose => arr(E.boot?.mailboxes).some(box => box.id === compose.mailboxId)).length;
  return count ? `<div class="cx-email-recovery"><p>${tr(`На устройстве есть незавершённые письма: ${count}.`,`Unfinished email saved on this device: ${count}.`)}</p><div class="cx-email-actions">${button('restore-drafts',tr('Восстановить','Restore'))}${button('discard-recovery',tr('Удалить локальную копию','Delete local copy'))}</div></div>` : '';
}
function openRecovery() {
  const drafts = arr(E.recoverable).filter(compose => arr(E.boot?.mailboxes).some(box => box.id === compose.mailboxId));
  sheet(tr('Восстановить незавершённое письмо','Recover unfinished email'),`<p>${tr('Восстановление открывает локальный текст для проверки. Оно не сохраняет и не отправляет письмо автоматически.','Recovery opens local text for review. It neither saves nor sends email automatically.')}</p><div class="cx-email-resource-picker">${drafts.map((compose,index) => `<button type="button" class="cx-email-resource-option" data-email-recover="${index}"><strong>${esc(compose.subject || tr('(без темы)','(no subject)'))}</strong><small>${esc(compose.to)}</small><span>${esc((compose.text || '').slice(0,160))}</span></button>`).join('')}</div>`,root => {
    root.querySelectorAll('[data-email-recover]').forEach(node => { node.onclick = async () => {
      const compose = drafts[Number(node.dataset.emailRecover)]; if (!compose) return;
      E.compose = {...compose,dirty:true,saving:false,recovered:true,savedAt:null};
      E.composers.set(compose.localKey,E.compose); E.selected = compose.threadId || null;
      E.recoverable = arr(E.recoverable).filter(item => item.localKey !== compose.localKey);
      closeSheet();
      if (E.selected) await loadThread(E.selected,{keepComposer:true}); else { E.detail = null; render(); }
    }; });
  });
}

function openAssistant() {
  if (!E.selected) return;
  captureComposer();
  sheet(tr('Помощник по переписке','Conversation assistant'),`<form class="cx-email-form"><label class="cx-email-field"><span>${tr('Что подготовить','What to prepare')}</span><select name="mode"><option value="summary">${tr('Краткое содержание','Summary')}</option><option value="reply">${tr('Черновик ответа','Reply draft')}</option><option value="rewrite">${tr('Переписать мой текст','Rewrite my text')}</option></select></label>${textField('text',tr('Мой текст для переработки','My text to rewrite'),{value:E.compose?.mode === 'external' ? E.compose.text : '',textarea:true})}${textField('instruction',tr('Пожелание к результату','Instructions'),{value:'',hint:tr('Например: короче и с конкретным следующим шагом.','For example: shorter, with a concrete next step.')})}<label class="cx-email-check"><input type="checkbox" name="consent" required><span>${tr('Разрешаю передать текст доступной мне переписки настроенному AI-провайдеру для этого запроса.','I allow the conversation content I can access to be sent to the configured AI provider for this request.')}</span></label><p class="cx-email-caption">${tr('Результат — предложение. Он не отправляет письмо, не принимает решение и не меняет задачу.','The result is a suggestion. It does not send email, accept a decision or change a Task.')}</p><button type="submit" class="cx-email-button is-primary">${tr('Подготовить','Generate suggestion')}</button></form>`,root => bindForm(root.querySelector('form'),async data => {
    const mode = data.get('mode');
    if (mode === 'rewrite' && !String(data.get('text')).trim()) throw new Error(tr('Добавьте текст для переработки.','Add text to rewrite.'));
    const result = await api(`/threads/${idPath(E.selected)}/assistant`,{method:'POST',body:{mode,consent:data.has('consent'),text:data.get('text'),instruction:data.get('instruction')}});
    sheet(tr('Предложение помощника','Assistant suggestion'),`<p class="cx-email-caption">${esc([result.provider,result.model].filter(Boolean).join(' · '))}</p>${result.contextTruncated ? `<p class="cx-email-notice">${tr('Контекст ограничен последними доступными письмами','Context is limited to the latest accessible email')}: ${esc(arr(result.sourceMessageIds).length)} ${tr('из','of')} ${esc(result.totalMessages || '—')}. ${tr('Более ранние письма и часть длинного текста могли не попасть в запрос. Проверьте исходную переписку.','Earlier email and parts of long messages may be omitted. Check the source conversation.')}</p>` : ''}<div class="cx-email-result-text">${esc(result.text || '')}</div><p class="cx-email-caption">${tr('Проверьте факты, тон и получателей перед использованием.','Review the facts, tone and recipients before using it.')}</p>${mode !== 'summary' ? button('use-suggestion',tr('Вставить в черновик','Insert into draft'),'','is-primary') : ''}`,body => {
      body.querySelector('[data-email-action="use-suggestion"]')?.addEventListener('click',() => {
        closeSheet(); if (!E.compose || E.compose.mode !== 'external') openComposer('external');
        E.compose.text = `${E.compose.text.trimEnd()}\n\n${result.text || ''}`.trimStart(); E.compose.dirty = true; render(); persistRecovery();
      });
    },{wide:true});
  }),{wide:true});
}

function openBooking(message) {
  const first = new Date(Date.now() + 86400000); first.setHours(10,0,0,0);
  const second = new Date(first.getTime() + 86400000);
  const expiry = new Date(Date.now() + 7 * 86400000);
  const slotRow = date => `<div class="cx-email-slot-row">${textField('startAt',tr('Начало','Start'),{type:'datetime-local',value:datetimeValue(date),required:true})}${textField('endAt',tr('Окончание','End'),{type:'datetime-local',value:datetimeValue(new Date(date.getTime() + 1800000)),required:true})}<button type="button" class="cx-email-button" data-email-remove-slot>${tr('Убрать','Remove')}</button></div>`;
  sheet(tr('Предложить время встречи','Offer meeting times'),`<form class="cx-email-form">${textField('title',tr('Публичное название','Public title'),{value:tr('Встреча','Meeting'),required:true})}${textField('durationMinutes',tr('Продолжительность, минут','Duration, minutes'),{type:'number',value:'30',required:true})}<div class="cx-email-slot-list" data-email-slot-list>${slotRow(first)}${slotRow(second)}</div>${button('add-slot',tr('Добавить вариант','Add a time option'))}${textField('expiresAt',tr('Ссылка действительна до','Link expires'),{type:'datetime-local',value:datetimeValue(expiry),required:true})}<p class="cx-email-notice">${tr('Доступность внешнего человека неизвестна. Время будет проверено при бронировании; предложение ещё не является встречей.','The external person’s availability is unknown. The time is checked at booking; an offer is not yet a meeting.')}</p><label class="cx-email-check"><input type="checkbox" name="confirmDisclosure" required><span>${tr('Подтверждаю: название и варианты времени будут доступны любому, у кого есть ссылка. Текст письма не публикуется.','I confirm the title and time options will be visible to anyone with the link. Email content is not published.')}</span></label><button type="submit" class="cx-email-button is-primary">${tr('Создать ссылку','Create link')}</button></form>`,root => {
    const form = root.querySelector('form');
    const durationField = form.elements.durationMinutes;
    durationField.min = '5'; durationField.max = '480'; durationField.step = '1';
    const applyDuration = row => {
      const start = safeDate(row.querySelector('[name="startAt"]').value);
      const duration = Number(durationField.value);
      if (start && Number.isInteger(duration) && duration >= 5 && duration <= 480) row.querySelector('[name="endAt"]').value = datetimeValue(new Date(start.getTime() + duration * 60000));
    };
    const bindSlots = () => root.querySelectorAll('.cx-email-slot-row').forEach(row => {
      row.querySelector('[data-email-remove-slot]').onclick = () => row.remove();
      row.querySelector('[name="startAt"]').onchange = () => applyDuration(row);
    }); bindSlots();
    durationField.onchange = () => root.querySelectorAll('.cx-email-slot-row').forEach(applyDuration);
    root.querySelector('[data-email-action="add-slot"]').onclick = () => {
      if (root.querySelectorAll('.cx-email-slot-row').length >= 60) return;
      const latest = safeDate([...root.querySelectorAll('[name="startAt"]')].at(-1)?.value) || second;
      root.querySelector('[data-email-slot-list]').insertAdjacentHTML('beforeend',slotRow(new Date(latest.getTime() + 86400000)));
      const row = [...root.querySelectorAll('.cx-email-slot-row')].at(-1); applyDuration(row); bindSlots();
    };
    bindForm(root.querySelector('form'),async data => {
      const starts = data.getAll('startAt'), ends = data.getAll('endAt');
      if (!starts.length) throw new Error(tr('Добавьте хотя бы один вариант времени.','Add at least one time option.'));
      const slots = starts.map((start,index) => {
        const startAt = safeDate(start), endAt = safeDate(ends[index]);
        if (!startAt || !endAt || endAt <= startAt || startAt.getTime() <= Date.now()) throw new Error(tr('Проверьте даты и продолжительность вариантов.','Check the time options and their durations.'));
        return {startAt:startAt.toISOString(),endAt:endAt.toISOString()};
      });
      const result = await api(`/messages/${idPath(message.id)}/booking-links`,{method:'POST',body:{title:data.get('title'),durationMinutes:Number(data.get('durationMinutes')),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',slots,expiresAt:safeDate(data.get('expiresAt'))?.toISOString(),confirmDisclosure:data.has('confirmDisclosure')}});
      const url = new URL(result.url,location.origin).href;
      sheet(tr('Ссылка на выбор времени','Meeting time selection link'),`<p>${tr('Ссылка создана. Отправьте её адресату после проверки.','The link is ready. Review it before sending it to the recipient.')}</p><label class="cx-email-field"><span>${tr('Ссылка','Link')}</span><input value="${esc(url)}" readonly></label><p class="cx-email-caption">${tr('Действительна до','Expires')}: ${esc(dateText(result.bookingLink?.expiresAt))}</p><div class="cx-email-actions">${button('copy-link',tr('Копировать','Copy'))}${button('insert-link',tr('Вставить в черновик','Insert into draft'),'','is-primary')}</div>`,body => {
        body.querySelector('[data-email-action="copy-link"]').onclick = async () => { try { await navigator.clipboard.writeText(url); E.bridge.toast?.(tr('Ссылка скопирована','Link copied')); } catch { body.querySelector('input').select(); } };
        body.querySelector('[data-email-action="insert-link"]').onclick = () => { closeSheet(); if (!E.compose || E.compose.mode !== 'external') openComposer('external'); E.compose.text = `${E.compose.text.trimEnd()}\n\n${url}`.trimStart(); E.compose.dirty = true; render(); persistRecovery(); };
      });
    });
  },{wide:true});
}

async function openRules(mailboxId) {
  try {
    const result = await api(`/mailboxes/${idPath(mailboxId)}/rules`);
    sheet(tr('Правила обработки почты','Email processing rules'),`<p class="cx-email-caption">${tr('Правила могут помечать, назначать, архивировать и откладывать входящие письма. Они не отправляют ответы и не принимают рабочие обязательства.','Rules can label, assign, archive and snooze incoming email. They do not send replies or accept work commitments.')}</p><div class="cx-email-template-list">${arr(result.items).map(rule => `<article><div><strong>${esc(rule.name)}</strong>${badge(rule.enabled ? tr('Включено','Enabled') : tr('Выключено','Disabled'))}</div><div class="cx-email-actions">${button('edit-rule',tr('Изменить','Edit'),`data-email-rule-id="${esc(rule.id)}"`)}${button('delete-rule',tr('Удалить','Delete'),`data-email-rule-id="${esc(rule.id)}"`)}</div></article>`).join('')}</div>${button('new-rule',tr('Добавить правило','Add rule'),'','is-primary')}`,root => {
      root.querySelector('[data-email-action="new-rule"]').onclick = () => editRule(mailboxId);
      root.querySelectorAll('[data-email-action="edit-rule"]').forEach(node => { node.onclick = () => editRule(mailboxId,arr(result.items).find(rule => rule.id === node.dataset.emailRuleId)); });
      root.querySelectorAll('[data-email-action="delete-rule"]').forEach(node => { node.onclick = async () => {
        const rule = arr(result.items).find(item => item.id === node.dataset.emailRuleId);
        try { await api(`/rules/${idPath(rule.id)}`,{method:'DELETE',body:{expectedVersion:rule.version}}); openRules(mailboxId); }
        catch (error) { report(error); }
      }; });
    },{wide:true});
  } catch (error) { report(error); }
}

function editRule(mailboxId, rule = null) {
  const condition = rule?.condition || {}, action = rule?.action || {};
  sheet(rule ? tr('Изменить правило','Edit rule') : tr('Новое правило','New rule'),`<form class="cx-email-form">${textField('name',tr('Название правила','Rule name'),{value:rule?.name || '',required:true})}<fieldset><legend>${tr('Все условия должны совпасть','All conditions must match')}</legend>${textField('fromIncludes',tr('Отправитель содержит','Sender contains'),{value:condition.fromIncludes || ''})}${textField('toIncludes',tr('Получатель содержит','Recipient contains'),{value:condition.toIncludes || ''})}${textField('subjectIncludes',tr('Тема содержит','Subject contains'),{value:condition.subjectIncludes || ''})}<label class="cx-email-check"><input type="checkbox" name="hasAttachments" ${condition.hasAttachments ? 'checked' : ''}><span>${tr('Есть вложения','Has attachments')}</span></label></fieldset><fieldset><legend>${tr('Действия','Actions')}</legend>${personField('assigneeId',tr('Назначить обработку сотруднику','Assign handling to employee'),action.assigneeId,{empty:true})}<div class="cx-email-checkbox-list">${arr(E.boot?.labels).map(label => `<label><input type="checkbox" name="labelIds" value="${esc(label.id)}" ${arr(action.labelIds).includes(label.id) ? 'checked' : ''}><span>${esc(label.name)}</span></label>`).join('')}</div><label class="cx-email-check"><input type="checkbox" name="archived" ${action.archived ? 'checked' : ''}><span>${tr('Архивировать','Archive')}</span></label>${textField('snoozeMinutes',tr('Отложить на минут','Snooze for minutes'),{type:'number',value:action.snoozeMinutes || '',min:'1'})}</fieldset><label class="cx-email-check"><input type="checkbox" name="enabled" ${rule?.enabled !== false ? 'checked' : ''}><span>${tr('Правило включено','Rule enabled')}</span></label>${button('preview-rule',tr('Проверить на существующих письмах','Preview against existing email'))}<div data-email-rule-preview aria-live="polite"></div><button type="submit" class="cx-email-button is-primary">${tr('Сохранить правило','Save rule')}</button></form>`,root => {
    const form = root.querySelector('form');
    const payload = () => {
      const data = new FormData(form), conditions = {}, actions = {};
      for (const field of ['fromIncludes','toIncludes','subjectIncludes']) if (String(data.get(field)).trim()) conditions[field] = String(data.get(field)).trim();
      if (data.has('hasAttachments')) conditions.hasAttachments = true;
      if (!Object.keys(conditions).length) throw new Error(tr('Добавьте хотя бы одно условие.','Add at least one condition.'));
      if (data.get('assigneeId')) actions.assigneeId = data.get('assigneeId');
      if (data.getAll('labelIds').length) actions.labelIds = data.getAll('labelIds');
      if (data.has('archived')) actions.archived = true;
      if (Number(data.get('snoozeMinutes')) > 0) actions.snoozeMinutes = Number(data.get('snoozeMinutes'));
      if (!Object.keys(actions).length) throw new Error(tr('Выберите действие.','Choose an action.'));
      return {name:data.get('name'),condition:conditions,action:actions,enabled:data.has('enabled'),...(rule ? {expectedVersion:rule.version} : {})};
    };
    root.querySelector('[data-email-action="preview-rule"]').onclick = async event => {
      const preview = root.querySelector('[data-email-rule-preview]');
      event.target.disabled = true;
      try {
        const body = payload(); const result = await api(`/mailboxes/${idPath(mailboxId)}/rules/preview`,{method:'POST',body:{condition:body.condition,action:body.action}});
        preview.className = 'cx-email-rule-preview';
        preview.innerHTML = `<strong>${tr('Совпадений','Matches')}: ${esc(result.total)} · ${tr('Проверено писем','Email checked')}: ${esc(result.scanned)}</strong>${arr(result.items).map(item => `<article>${esc(item.subject || tr('(без темы)','(no subject)'))}<br><span class="cx-email-caption">${esc(typeof item.from === 'string' ? item.from : displayAddress(item.from))}</span></article>`).join('')}<p>${tr('Предпросмотр не меняет письма.','Preview does not change email.')}</p>`;
      } catch (error) { preview.textContent = error.message; preview.className = 'cx-email-error'; }
      finally { event.target.disabled = false; }
    };
    bindForm(form,async () => { await api(rule ? `/rules/${idPath(rule.id)}` : `/mailboxes/${idPath(mailboxId)}/rules`,{method:rule ? 'PATCH' : 'POST',body:payload()}); openRules(mailboxId); });
  },{wide:true});
}

window.addEventListener('chat:localechange',() => { captureComposer(); render(); });
window.addEventListener('offline',() => { captureComposer(); persistRecovery(); render(); });
window.addEventListener('online',() => { render(); if (E.mounted) refresh(); });
window.addEventListener('pagehide',() => { captureComposer(); persistRecovery(); });
window.addEventListener('beforeunload',event => {
  captureComposer(); persistRecovery();
  const unfinished = [...E.composers.values()].flatMap(compose => [compose,...Object.values(compose.priorModes || {})]);
  if (unfinished.some(compose => compose.dirty && (compose.mode !== 'external' || !recoveryEnabled()))) { event.preventDefault(); event.returnValue = ''; }
});

window.ChatEmail = {configure,mount,unmount,openSettings,openThread,openQueue,refresh,reset};
window.dispatchEvent(new CustomEvent('chat:email-ready'));
