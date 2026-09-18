const O={permissions:new Set(),people:[],session:null,accessAt:0,tab:'jobs',jobs:null,costs:null,prices:null};
const $=(q,r=document)=>r.querySelector(q),$$=(q,r=document)=>[...r.querySelectorAll(q)];
const esc=(v='')=>String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const locale=()=>window.ChatPreferences?.locale==='en'?'en':'ru';
const tr=(ru,en)=>locale()==='en'?en:ru;
const fmtDate=(v)=>v?new Intl.DateTimeFormat(locale()==='en'?'en':'ru',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(v)):tr('Нет даты','No date');
const fmtMoney=(amount,currency)=>amount==null?tr('Не рассчитано','Not priced'):`${String(amount)} ${currency||''}`.trim();
const personName=(id)=>O.people.find(p=>p.userId===id)?.displayName||O.people.find(p=>p.userId===id)?.email||tr('Сотрудник','Employee');
const PERM={ops:'meeting.ops.manage',costRead:'meeting.cost.read',costManage:'meeting.cost.manage'};

async function api(path,options={}){const response=await fetch(path,{credentials:'same-origin',...options,headers:{...(options.body?{'content-type':'application/json'}:{}),...(options.headers||{})}});const payload=response.status===204?null:await response.json().catch(()=>null);if(!response.ok){const error=new Error(payload?.error?.message||`HTTP ${response.status}`);error.status=response.status;error.code=payload?.error?.code;throw error}return payload}
function toast(text){const root=$('#toast-root');if(!root)return;const node=document.createElement('div');node.className='toast';node.textContent=text;root.append(node);setTimeout(()=>node.remove(),2800)}
function has(permission){return O.permissions.has(permission)}
function canOpen(){return has(PERM.ops)||has(PERM.costRead)}
function appVisible(){const app=$('#app-view');return Boolean(app&&!app.hidden)}

async function loadAccess(force=false){
  if(!force&&Date.now()-O.accessAt<5000&&O.session)return O;
  try{
    const boot=await api('/api/v1/bootstrap');
    O.permissions=new Set(boot.permissions||[]);
    O.people=boot.people||[];
    O.session=boot.session||null;
    O.accessAt=Date.now();
  }catch{
    O.permissions=new Set();O.people=[];O.session=null;O.accessAt=0;
  }
  return O;
}

function removeOverlay(){document.querySelector('.mio-overlay')?.remove()}
function clearOpsHash(){if(location.hash==='#/meeting-operations')history.pushState(null,'',location.pathname+location.search)}
function closeOps(clearHash=true){removeOverlay();if(clearHash)clearOpsHash()}
function availableTabs(){const tabs=[];if(has(PERM.ops))tabs.push('jobs');if(has(PERM.costRead)){tabs.push('costs','prices')}return tabs}
function tabLabel(tab){return({jobs:tr('Обработка','Processing'),costs:tr('Стоимость','Cost'),prices:tr('Тарифы','Pricing')})[tab]||tab}
function statusLabel(status){return({failed:tr('Ошибка','Failed'),dead_letter:tr('Остановлено','Dead letter'),pending:tr('В очереди','Queued'),processing:tr('В работе','Processing'),succeeded:tr('Готово','Succeeded')})[status]||status}
function kindLabel(kind){return kind==='transcribe'?tr('Стенограмма','Transcription'):tr('Итоги','Summary')}
function unpricedLabel(reason){return({no_price_version:tr('Нет тарифа на дату вызова','No price version for call date'),usage_schema_mismatch:tr('Тариф не совпадает со схемой usage','Pricing does not match usage schema'),usage_unavailable:tr('Провайдер не вернул usage','Provider returned no usage')})[reason]||tr('Не рассчитано','Not priced')}
function workerCopy(worker){
  if(worker?.running)return tr('Фоновая обработка запущена','Worker is running');
  if(worker?.configured===false)return tr('Фоновая обработка отключена','Worker is disabled');
  return worker?.reason||tr('Фоновая обработка ожидает доступный AI-провайдер','Worker is waiting for an available AI provider');
}

async function decorateMeetingCenter(){
  const header=$('.mi-overlay:not(.mio-overlay) .mi-header');
  if(!header||header.querySelector('.mio-entry'))return;
  const kicker=header.querySelector('.mi-kicker')?.textContent?.trim();
  if(kicker!=='MEETING INTELLIGENCE')return;
  await loadAccess();
  if(!canOpen()||!header.isConnected)return;
  const button=document.createElement('button');
  button.className='mi-button secondary mio-entry';
  button.type='button';
  button.dataset.mioOpen='jobs';
  button.textContent=tr('Контроль','Operations');
  const close=header.querySelector('[data-mi-close]');
  header.insertBefore(button,close||null);
}

function shell(tab){
  const tabs=availableTabs();
  O.tab=tabs.includes(tab)?tab:tabs[0];
  document.querySelector('.mi-overlay')?.remove();
  const overlay=document.createElement('div');overlay.className='mi-overlay mio-overlay';
  overlay.innerHTML=`<section class="mi-panel wide mio-panel">
    <header class="mi-header">
      <div style="display:flex;gap:12px;align-items:flex-start">
        <button class="mi-back" data-mio-back aria-label="${tr('Назад','Back')}">‹</button>
        <div><p class="mi-kicker">MEETING OPERATIONS</p><h2>${tr('Контроль встреч','Meeting operations')}</h2></div>
      </div>
      <button class="mi-close" data-mio-close aria-label="${tr('Закрыть','Close')}">×</button>
    </header>
    <div class="mi-body">
      <div class="mi-filters mio-tabs">${tabs.map(value=>`<button class="mi-filter ${value===O.tab?'active':''}" data-mio-tab="${value}">${esc(tabLabel(value))}</button>`).join('')}</div>
      <div id="mio-content"></div>
    </div>
  </section>`;
  document.body.append(overlay);
  overlay.addEventListener('click',event=>{if(event.target===overlay)closeOps()});
  return overlay;
}

async function openOps(tab='jobs',{updateHash=true}={}){
  await loadAccess(true);
  if(!canOpen()){toast(tr('У вас нет доступа к Meeting Operations','You do not have access to Meeting Operations'));return}
  shell(tab);
  if(updateHash&&location.hash!=='#/meeting-operations')history.pushState(null,'','/#/meeting-operations');
  await renderTab(O.tab);
}

function loading(text){const root=$('#mio-content');if(root)root.innerHTML=`<div class="mi-empty">${esc(text)}</div>`}
function errorState(error){const root=$('#mio-content');if(root)root.innerHTML=`<div class="mi-empty"><strong>${tr('Не удалось загрузить данные','Could not load data')}</strong>${esc(error.message)}</div>`}
async function renderTab(tab){
  O.tab=tab;
  $$('.mio-tabs [data-mio-tab]').forEach(button=>button.classList.toggle('active',button.dataset.mioTab===tab));
  if(tab==='jobs')return renderJobs();
  if(tab==='costs')return renderCosts();
  return renderPrices();
}

function jobCard(job){
  const retryable=['failed','dead_letter'].includes(job.status);
  const cls=job.status==='dead_letter'||job.status==='failed'?'failed':job.status==='succeeded'?'ready':'processing';
  return `<article class="mio-card">
    <div class="mio-card-head"><div><div class="mi-proposal-type">${esc(kindLabel(job.kind))}</div><h3>${esc(statusLabel(job.status))}</h3></div><span class="mi-pill ${cls}">${job.attempts}/${job.maxAttempts}</span></div>
    <div class="mi-meta"><span>${esc(fmtDate(job.updatedAt||job.availableAt))}</span><span>· ${tr('попыток','attempts')}: ${job.attempts}</span></div>
    ${job.lastError?`<p class="mio-error">${esc(job.lastError)}</p>`:''}
    <div class="mi-proposal-actions">
      ${job.callId?`<button class="mi-button secondary" data-mio-call="${job.callId}">${tr('Открыть встречу','Open meeting')}</button>`:''}
      <button class="mi-button secondary" data-mio-audit="${job.id}">${tr('История','Audit')}</button>
      ${retryable?`<button class="mi-button" data-mio-retry="${job.id}">${tr('Повторить обработку','Retry processing')}</button>`:''}
    </div>
  </article>`;
}
async function renderJobs(){
  loading(tr('Загружаем состояние обработки…','Loading processing state…'));
  try{
    const payload=await api('/api/v1/admin/meeting-jobs?statuses=failed,dead_letter&limit=80');
    O.jobs=payload;
    const root=$('#mio-content');if(!root)return;
    root.innerHTML=`<div class="mi-stack">
      <section class="mio-health"><div><span class="mio-dot ${payload.worker?.running?'ok':''}"></span><strong>${esc(workerCopy(payload.worker))}</strong></div><span>${(payload.worker?.activeKinds||[]).map(kindLabel).join(' · ')}</span></section>
      <section class="mi-section">
        <div class="mi-section-head"><div><h3>${tr('Требуют вмешательства','Needs intervention')}</h3><span>${tr('Только ошибки, требующие ручного вмешательства; история попыток не сбрасывается','Failed/dead-letter jobs only; attempt history is never reset')}</span></div><span>${payload.items?.length||0}</span></div>
        <div class="mi-stack">${payload.items?.length?payload.items.map(jobCard).join(''):`<div class="mi-empty"><strong>${tr('Ошибок обработки нет','No processing failures')}</strong>${tr('Здесь появятся только случаи, где действительно требуется ручное решение.','Only jobs requiring manual intervention appear here.')}</div>`}</div>
      </section>
    </div>`;
  }catch(error){errorState(error)}
}

function retrySheet(jobId){
  const panel=$('.mio-panel');if(!panel)return;
  $('.mi-sheet-wrap')?.remove();
  const wrap=document.createElement('div');wrap.className='mi-sheet-wrap';
  wrap.innerHTML=`<div class="mi-sheet">
    <div><p class="mi-kicker">${tr('РУЧНОЕ ВОССТАНОВЛЕНИЕ','MANUAL RECOVERY')}</p><h3>${tr('Повторить обработку','Retry processing')}</h3><p class="mio-note">${tr('Причина обязательна. Прошлые попытки сохраняются; добавляется только новый ограниченный бюджет попыток.','A reason is required. Previous attempts remain intact; only a bounded future attempt budget is added.')}</p></div>
    <label class="mi-field">${tr('Причина','Reason')}<textarea id="mio-retry-reason" rows="4" maxlength="1000" placeholder="${tr('Например: сбой провайдера устранён','Example: provider incident has been resolved')}"></textarea></label>
    <label class="mi-field">${tr('Дополнительные попытки','Additional attempts')}<select id="mio-extra-attempts"><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label>
    <div class="mi-sheet-actions"><button class="mi-button secondary" data-mio-sheet-close>${tr('Отмена','Cancel')}</button><button class="mi-button" data-mio-retry-confirm="${jobId}">${tr('Запустить повторно','Retry')}</button></div>
  </div>`;
  panel.append(wrap);$('#mio-retry-reason')?.focus();
}
async function retryJob(jobId){
  const reason=$('#mio-retry-reason')?.value.trim()||'';
  const extraAttempts=Number($('#mio-extra-attempts')?.value||1);
  if(!reason){toast(tr('Укажите причину повторной обработки','Enter a reason for the retry'));return}
  const button=$('[data-mio-retry-confirm]');if(button)button.disabled=true;
  try{
    await api(`/api/v1/admin/meeting-jobs/${jobId}/retry`,{method:'POST',body:JSON.stringify({reason,extraAttempts})});
    $('.mi-sheet-wrap')?.remove();
    toast(tr('Обработка возвращена в очередь','Job returned to the queue'));
    await renderJobs();
  }catch(error){toast(error.message);if(button)button.disabled=false}
}
async function auditSheet(jobId){
  const panel=$('.mio-panel');if(!panel)return;
  $('.mi-sheet-wrap')?.remove();
  const wrap=document.createElement('div');wrap.className='mi-sheet-wrap';
  wrap.innerHTML=`<div class="mi-sheet mio-audit-sheet"><div><p class="mi-kicker">AUDIT TRAIL</p><h3>${tr('История восстановления','Recovery history')}</h3></div><div id="mio-audit-list"><div class="mi-empty">${tr('Загружаем историю…','Loading history…')}</div></div><button class="mi-button secondary" data-mio-sheet-close>${tr('Закрыть','Close')}</button></div>`;
  panel.append(wrap);
  try{
    const payload=await api(`/api/v1/admin/meeting-jobs/${jobId}/audit?limit=50`);
    const root=$('#mio-audit-list');if(!root)return;
    root.innerHTML=payload.items?.length?payload.items.map(event=>`<article class="mio-audit-event"><div class="mio-card-head"><strong>#${event.sequence} · ${esc(event.eventType)}</strong><span>${esc(fmtDate(event.createdAt))}</span></div><p>${esc(event.payload?.reason||tr('Без пояснения','No note'))}</p><div class="mi-meta"><span>${tr('Инициатор','Actor')}: ${esc(personName(event.actorId))}</span>${event.payload?.previous?`<span>· ${tr('до повтора','before retry')}: ${event.payload.previous.attempts}/${event.payload.previous.maxAttempts}</span>`:''}</div></article>`).join(''):`<div class="mi-empty">${tr('История ручного восстановления пуста','No manual recovery history')}</div>`;
  }catch(error){const root=$('#mio-audit-list');if(root)root.innerHTML=`<div class="mi-empty">${esc(error.message)}</div>`}
}

function dateFilterHtml(){
  return `<form id="mio-cost-filter" class="mio-filter-form">
    <label class="mi-field">${tr('С','From')}<input name="from" type="date"></label>
    <label class="mi-field">${tr('По','To')}<input name="to" type="date"></label>
    <button class="mi-button" type="submit">${tr('Обновить','Refresh')}</button>
  </form>`;
}
function dayIso(value,end=false){
  if(!value)return null;
  const parts=value.split('-').map(Number);if(parts.length!==3||parts.some(n=>!Number.isFinite(n)))return null;
  const date=new Date(parts[0],parts[1]-1,parts[2],end?23:0,end?59:0,end?59:0,end?999:0);
  return date.toISOString();
}
function rollupHtml(rollup){
  const currencies=rollup?.currencies||[];
  const money=currencies.length?currencies.map(item=>`<div class="mio-kpi"><span>${esc(item.currency)}</span><strong>${esc(String(item.amount))}</strong></div>`).join(''):`<div class="mio-kpi"><span>${tr('Стоимость','Cost')}</span><strong>—</strong></div>`;
  return `<div class="mio-kpis">${money}<div class="mio-kpi"><span>${tr('Рассчитано','Priced')}</span><strong>${rollup?.pricedCalls||0}</strong></div><div class="mio-kpi"><span>${tr('Без цены','Unpriced')}</span><strong>${rollup?.unpricedCalls||0}</strong></div><div class="mio-kpi"><span>${tr('Всего вызовов','Total calls')}</span><strong>${rollup?.totalCalls||0}</strong></div></div>`;
}
function providerRollupHtml(providers=[]){
  if(!providers.length)return'';
  return `<section class="mi-section"><div class="mi-section-head"><div><h3>${tr('По моделям','By model')}</h3><span>${tr('Суммы не объединяются между валютами','Currencies are never combined')}</span></div></div><div class="mio-table">${providers.map(item=>`<div class="mio-table-row"><span><strong>${esc(item.provider)}</strong><small>${esc(item.model)} · ${esc(kindLabel(item.kind))}</small></span><span>${item.calls} ×</span><strong>${esc(fmtMoney(item.amount,item.currency))}</strong></div>`).join('')}</div></section>`;
}
function costCallCard(call){
  const priced=call.pricing?.priced;
  return `<article class="mio-call-row"><div><strong>${esc(call.provider)} · ${esc(call.model)}</strong><span>${esc(kindLabel(call.kind))} · ${esc(fmtDate(call.startedAt))}</span></div><div><span class="mi-pill ${call.status==='failed'?'failed':'ready'}">${esc(statusLabel(call.status))}</span><strong class="${priced?'':'mio-unpriced'}">${priced?esc(fmtMoney(call.pricing.amount,call.pricing.currency)):esc(unpricedLabel(call.pricing?.reason))}</strong></div></article>`;
}
async function renderCosts(query=null){
  loading(tr('Считаем стоимость по provider usage…','Calculating cost from provider usage…'));
  try{
    let suffix='?limit=100';
    if(query?.from)suffix+=`&from=${encodeURIComponent(query.from)}`;
    if(query?.to)suffix+=`&to=${encodeURIComponent(query.to)}`;
    const report=await api('/api/v1/admin/meeting-costs'+suffix);O.costs=report;
    const root=$('#mio-content');if(!root)return;
    root.innerHTML=`<div class="mi-stack">
      ${dateFilterHtml()}
      <div class="mio-note">${tr('Итог считается по всему выбранному периоду. Ниже показывается только ограниченная детализация provider attempts. Неуспешная попытка учитывается, если провайдер фактически вернул usage.','The rollup covers the full selected period. Only provider-attempt detail is limited below. A failed attempt is costed when the provider actually returned usage.')}</div>
      ${rollupHtml(report.rollup)}
      ${providerRollupHtml(report.rollup?.providers)}
      <section class="mi-section"><div class="mi-section-head"><div><h3>${tr('Последние вызовы','Recent provider calls')}</h3><span>${tr('Без provider request IDs и внутренних source metadata','No provider request IDs or internal source metadata')}</span></div><span>${report.calls?.length||0}</span></div><div class="mio-call-list">${report.calls?.length?report.calls.map(costCallCard).join(''):`<div class="mi-empty">${tr('Данные об использовании AI-провайдера за период отсутствуют','No provider usage in this period')}</div>`}</div></section>
    </div>`;
  }catch(error){errorState(error)}
}

function priceVersionCard(version){
  return `<article class="mio-card"><div class="mio-card-head"><div><div class="mi-proposal-type">${esc(kindLabel(version.kind))}</div><h3>${esc(version.provider)} · ${esc(version.model)}</h3></div><span class="mi-pill">${esc(version.currency)}</span></div><div class="mi-meta"><span>${tr('Действует с','Effective from')} ${esc(fmtDate(version.effectiveFrom))}</span>${version.sourceRef?`<span>· ${esc(version.sourceRef)}</span>`:''}</div><div class="mio-price-items">${(version.items||[]).map(item=>`<div><span>${esc(item.metricName)} · ${esc(item.usagePath)}</span><strong>${esc(item.unitPrice)} ${esc(version.currency)} / ${esc(item.unitQuantity)}</strong></div>`).join('')}</div>${version.note?`<p class="mio-note">${esc(version.note)}</p>`:''}</article>`;
}
async function renderPrices(){
  loading(tr('Загружаем версии тарифов…','Loading pricing versions…'));
  try{
    const payload=await api('/api/v1/admin/meeting-prices');O.prices=payload.items||[];
    const root=$('#mio-content');if(!root)return;
    root.innerHTML=`<div class="mi-stack"><section class="mi-section"><div class="mi-section-head"><div><h3>${tr('Версии тарифов','Pricing versions')}</h3><span>${tr('История не редактируется: изменение тарифа создаёт новую effective version','History is immutable: a price change creates a new effective version')}</span></div>${has(PERM.costManage)?`<button class="mi-button" data-mio-price-new>${tr('Новая версия','New version')}</button>`:''}</div><div class="mi-stack">${O.prices.length?O.prices.map(priceVersionCard).join(''):`<div class="mi-empty"><strong>${tr('Тарифы ещё не заведены','No pricing versions yet')}</strong>${tr('Пока версия тарифа отсутствует, стоимость вызова провайдера остаётся нерассчитанной.','Until a pricing version exists, provider call cost remains explicitly unpriced.')}</div>`}</div></section></div>`;
  }catch(error){errorState(error)}
}
function priceItemRow(){
  return `<div class="mio-price-row" data-mio-price-row><input name="metricName" placeholder="${tr('Метрика, напр. input_tokens','Metric, e.g. input_tokens')}" required><input name="usagePath" placeholder="${tr('Путь usage, напр. input_tokens','Usage path, e.g. input_tokens')}" required><input name="unitQuantity" inputmode="decimal" placeholder="${tr('Количество единиц','Unit quantity')}" required><input name="unitPrice" inputmode="decimal" placeholder="${tr('Цена за единицу','Unit price')}" required><button type="button" class="mi-close mio-row-remove" data-mio-price-remove aria-label="${tr('Удалить','Remove')}">×</button></div>`;
}
function priceSheet(){
  const panel=$('.mio-panel');if(!panel)return;
  $('.mi-sheet-wrap')?.remove();
  const wrap=document.createElement('div');wrap.className='mi-sheet-wrap';
  wrap.innerHTML=`<div class="mi-sheet mio-price-sheet"><div><p class="mi-kicker">${tr('НОВАЯ ВЕРСИЯ ТАРИФА','NEW PRICING VERSION')}</p><h3>${tr('Добавить тариф провайдера','Add provider pricing')}</h3><p class="mio-note">${tr('Это новая версия, а не редактирование истории. Значения цены не подставляются автоматически.','This creates a new version and never edits history. No price values are prefilled.')}</p></div>
    <form id="mio-price-form" class="mio-price-form">
      <div class="mio-form-grid"><label class="mi-field">${tr('Провайдер','Provider')}<input name="provider" placeholder="openai" required></label><label class="mi-field">${tr('Модель','Model')}<input name="model" placeholder="model-id" required></label><label class="mi-field">${tr('Контур','Kind')}<select name="kind"><option value="transcribe">${tr('Стенограмма','Transcription')}</option><option value="summarize">${tr('Итоги','Summary')}</option></select></label><label class="mi-field">${tr('Валюта','Currency')}<input name="currency" maxlength="3" placeholder="USD / EUR" required></label><label class="mi-field">${tr('Действует с','Effective from')}<input name="effectiveFrom" type="datetime-local" required></label><label class="mi-field">${tr('Источник цены','Price source')}<input name="sourceRef" placeholder="${tr('Ссылка или идентификатор прайса','Pricing URL or reference')}"></label></div>
      <label class="mi-field">${tr('Комментарий','Note')}<textarea name="note" rows="2"></textarea></label>
      <div><div class="mio-items-head"><strong>${tr('Компоненты тарифа','Pricing components')}</strong><button type="button" class="mi-button secondary" data-mio-price-add>＋ ${tr('Добавить','Add')}</button></div><div id="mio-price-items" class="mi-stack">${priceItemRow()}</div></div>
      <div class="mi-sheet-actions"><button type="button" class="mi-button secondary" data-mio-sheet-close>${tr('Отмена','Cancel')}</button><button type="submit" class="mi-button">${tr('Создать версию','Create version')}</button></div>
    </form></div>`;
  panel.append(wrap);
}
async function submitPrice(form){
  const rows=$$('[data-mio-price-row]',form).map(row=>({metricName:$('[name="metricName"]',row)?.value.trim(),usagePath:$('[name="usagePath"]',row)?.value.trim(),unitQuantity:$('[name="unitQuantity"]',row)?.value.trim(),unitPrice:$('[name="unitPrice"]',row)?.value.trim()}));
  const data=new FormData(form);
  const effective=data.get('effectiveFrom');
  const body={provider:data.get('provider'),model:data.get('model'),kind:data.get('kind'),currency:String(data.get('currency')||'').toUpperCase(),effectiveFrom:effective?new Date(effective).toISOString():null,sourceRef:data.get('sourceRef')||null,note:data.get('note')||null,items:rows};
  const submit=form.querySelector('[type="submit"]');if(submit)submit.disabled=true;
  try{await api('/api/v1/admin/meeting-prices',{method:'POST',body:JSON.stringify(body)});$('.mi-sheet-wrap')?.remove();toast(tr('Новая версия тарифа сохранена','New pricing version saved'));await renderPrices()}catch(error){toast(error.message);if(submit)submit.disabled=false}
}

document.addEventListener('click',event=>{
  const target=event.target;
  const open=target.closest('[data-mio-open]');if(open){event.preventDefault();event.stopPropagation();openOps(open.dataset.mioOpen||'jobs');return}
  if(target.closest('[data-mio-close]')){closeOps();return}
  if(target.closest('[data-mio-back]')){closeOps(false);history.replaceState(null,'','/#/meetings');window.ChatMeetingIntelligence?.openCenter?.('all',{updateHash:false});return}
  const tab=target.closest('[data-mio-tab]');if(tab){renderTab(tab.dataset.mioTab);return}
  const retry=target.closest('[data-mio-retry]');if(retry){retrySheet(retry.dataset.mioRetry);return}
  const confirm=target.closest('[data-mio-retry-confirm]');if(confirm){retryJob(confirm.dataset.mioRetryConfirm);return}
  const audit=target.closest('[data-mio-audit]');if(audit){auditSheet(audit.dataset.mioAudit);return}
  if(target.closest('[data-mio-sheet-close]')){$('.mi-sheet-wrap')?.remove();return}
  const call=target.closest('[data-mio-call]');if(call){closeOps(false);window.ChatMeetingIntelligence?.openMeeting?.(call.dataset.mioCall,{updateHash:true});return}
  if(target.closest('[data-mio-price-new]')){priceSheet();return}
  if(target.closest('[data-mio-price-add]')){$('#mio-price-items')?.insertAdjacentHTML('beforeend',priceItemRow());return}
  const remove=target.closest('[data-mio-price-remove]');if(remove){const rows=$$('[data-mio-price-row]');if(rows.length>1)remove.closest('[data-mio-price-row]')?.remove();return}
},true);

document.addEventListener('submit',event=>{
  if(event.target.id==='mio-cost-filter'){event.preventDefault();const data=new FormData(event.target);renderCosts({from:dayIso(data.get('from')),to:dayIso(data.get('to'),true)});return}
  if(event.target.id==='mio-price-form'){event.preventDefault();submitPrice(event.target)}
},true);

document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('.mio-overlay')){if($('.mi-sheet-wrap'))$('.mi-sheet-wrap')?.remove();else closeOps()}},true);
window.addEventListener('hashchange',()=>route());window.addEventListener('chat:localechange',()=>{if($('.mio-overlay'))openOps(O.tab,{updateHash:false});else decorateMeetingCenter()});
const observer=new MutationObserver(()=>{if(appVisible()){decorateMeetingCenter();if(location.hash==='#/meeting-operations'&&!$('.mio-overlay'))route()}else{O.permissions=new Set();O.people=[];O.session=null;O.accessAt=0;removeOverlay()}});observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','class']});
async function route(){if(!appVisible())return;if(location.hash==='#/meeting-operations')await openOps(O.tab,{updateHash:false});else if($('.mio-overlay'))removeOverlay()}
window.ChatMeetingOperations={open:openOps,refresh:()=>renderTab(O.tab)};
(async function start(){if(appVisible())await decorateMeetingCenter();route()})();
