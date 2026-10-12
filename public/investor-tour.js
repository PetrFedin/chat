/**
 * Guided investor walkthrough over existing ChatX authorities. This module
 * never manufactures customers, outcomes or performance metrics and never
 * grants access to resources that the caller cannot already read.
 */
const isUuid = id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export function canonicalProofLink(kind,id) {
  if (!isUuid(id)) return null;
  const routes={conversation:'chats',task:'tasks',project:'projects',calendar:'calendar'};
  return routes[kind] ? `/#/${routes[kind]}/${id}` : null;
}

/** A what-if calculation, NEVER a measured result or a forecast. */
export function hypotheticalEconomics(input={}) {
  const required=['people','hoursPerWeek','hourCost','platformPerMonth','implementationCost','months'];
  if (required.some(key=>input[key]===null || input[key]===undefined || String(input[key]).trim()==='')) return null;
  const n=Object.fromEntries(required.map(k=>[k,Number(input[k])]));
  if (required.some(k=>!Number.isFinite(n[k]) || n[k]<0)) return null;
  if (!Number.isInteger(n.people) || n.people<1 || !Number.isInteger(n.months) || n.months<1 || n.months>120) return null;
  if (n.people>1000000 || n.hoursPerWeek>168 || n.hourCost>100000000 || n.platformPerMonth>100000000000 || n.implementationCost>100000000000) return null;
  const monthlyGross = n.people*n.hoursPerWeek*n.hourCost*52/12;
  const monthlyNet = monthlyGross - n.platformPerMonth - n.implementationCost/n.months;
  const monthlyContribution = monthlyGross - n.platformPerMonth;
  const paybackMonths = monthlyContribution>0 ? n.implementationCost/monthlyContribution : null;
  return {monthlyGross,monthlyNet,monthlyPlatform:n.platformPerMonth,monthlyImplementation:n.implementationCost/n.months,paybackMonths};
}

const valueOrDash=x=>typeof x==='number'&&Number.isFinite(x)?String(x):'—';
const resolved=r=>r.status==='fulfilled'?r.value:null;

export async function openInvestorTour({api,modal,esc,T,session,conversations=[],tasks=[],can=()=>false}){
  // Each read goes through the application's authenticated API and RBAC.
  // Partial service outage must be visible, not silently substituted with zeros.
  const [demoResult,projectsResult,dashboardResult,meetingsResult] = await Promise.allSettled([
    api('/api/v1/demo'),
    api('/api/v1/projects'),
    api('/api/v1/dashboard?scope='+ (can('task.manage.team')?'team':'mine')),
    api('/api/v1/meetings?limit=20'),
  ]);
  const demo=resolved(demoResult);
  const projects=resolved(projectsResult)?.items??[];
  const selected=projects.find(p=>p.name==='Mobile Launch · Northstar Studio (demo)')??projects[0]??null;
  let project=null,projectError=null;
  if(selected && isUuid(selected.id)){
    try{project=(await api('/api/v1/projects/'+selected.id)).project}
    catch(e){projectError=e}
  }
  const dashboard=resolved(dashboardResult);
  const meetingItems=resolved(meetingsResult)?.items??[];
  const syntheticMeeting=meetingItems.find(m=>m.synthetic && m.intelligenceStatus==='review_ready');
  const sourceMessageTask=tasks.find(t=>t.sourceMessageId && isUuid(t.id));
  const task=sourceMessageTask??project?.tasks?.find(t=>isUuid(t.id))??null;
  const channel=conversations.find(c=>c.slug==='product' && isUuid(c.id))??null;
  const isDemo=Boolean(demo?.enabled && session?.email==='demo@northstar.example');
  const dbAvailable=projectsResult.status==='fulfilled';
  const dashboardAvailable=dashboardResult.status==='fulfilled';
  const meetingsAvailable=meetingsResult.status==='fulfilled';
  const fmt=(label,x)=>`<div class="investor-stat"><span class="row-sub">${esc(label)}</span><strong>${esc(valueOrDash(x))}</strong></div>`;
  const proofLink=(href,label)=>{
    if(!href)return '<span class="muted">Нет доступного объекта</span>';
    return `<a class="chipbtn pressable" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`;
  };
  const routeProject=canonicalProofLink('project',project?.id??selected?.id);
  const routeTask=canonicalProofLink('task',task?.id);
  const routeConversation=canonicalProofLink('conversation',channel?.id);
  const validMeeting=syntheticMeeting&&isUuid(syntheticMeeting.callId);
  const steps=[
    {
      heading:T('01 · Источник обязательства','01 · Source of commitment'),
      description:T('Обсуждение превращается в каноническую задачу. Источник и исполнитель проверяются в рабочих карточках.','A discussion becomes a canonical task with source and owner.'),
      evidence:channel?.title??T('Канал недоступен','Channel unavailable'),href:routeConversation,
      link:T('Открыть обсуждение','Open discussion'),
    },
    {
      heading:T('02 · Контроль исполнения','02 · Execution control'),
      description:T('Ответственный, срок, блокировка, доказательства и приёмка — единый жизненный цикл задачи.','Owner, deadline, blockers, evidence and acceptance share the same task lifecycle.'),
      evidence:task?.title??T('Задача недоступна','Task unavailable'),href:routeTask,
      link:T('Открыть задачу','Open task'),
    },
    {
      heading:T('03 · Project Cockpit','03 · Project Cockpit'),
      description:T('Проект отображает существующие задачи и обсуждения, а не копирует их статусы.','A project projects existing tasks and conversations, without copying their state.'),
      evidence:project?.name??selected?.name??T('Проект не подготовлен','Project unavailable'),href:routeProject,
      link:T('Открыть проект','Open project'),
    },
    {
      heading:T('04 · Встреча → решение','04 · Meeting to decision'),
      description:T('Транскрипт и предложения ИИ требуют подтверждения человеком; демонстрационная стенограмма помечена как синтетическая.','Meeting intelligence requires human confirmation; synthetic fixtures are clearly marked.'),
      evidence:syntheticMeeting?T('Синтетическая встреча: review-ready','Synthetic meeting: review-ready'):(meetingsAvailable?T('Нет подтверждённого демонстрационного транскрипта','No verified demo transcript'):T('API встреч недоступен','Meeting API unavailable')),
      href:validMeeting?'/#/calendar':'/#/calendar',
      link:T('Открыть календарь','Open calendar'),
    },
    {
      heading:T('05 · Метрики и аудит','05 · Metrics and audit'),
      description:T('Дашборд считает показатели из канонических отчётов; экономия денег здесь не утверждается.','Dashboard numbers come from canonical task reports; no savings are claimed.'),
      evidence:dashboardAvailable?T('Рабочий API аналитики','Analytics API available'):T('Аналитика требует PostgreSQL','Analytics requires PostgreSQL'),
      href:'/#/more/dashboard',link:T('Открыть дашборд','Open dashboard'),
    },
  ];
  const panels=steps.map(step=>`<section class="surface investor-tour-step">
    <div><strong>${esc(step.heading)}</strong><p class="muted">${esc(step.description)}</p><div class="row-sub">${esc(step.evidence)}</div></div>
    <div>${proofLink(step.href,step.link)}</div>
  </section>`).join('');
  const unavailable=[
    !dbAvailable?T('Проекты: API недоступен','Projects: API unavailable'):null,
    projectError?T('Проект: ошибка проверки доступа','Project: access error'):null,
    !dashboardAvailable?T('Дашборд: API недоступен','Dashboard: API unavailable'):null,
    !meetingsAvailable?T('Встречи: API недоступен','Meetings: API unavailable'):null,
  ].filter(Boolean);
  const moneyLabels=[
    ['people',T('Сотрудников','Employees'),1],
    ['hoursPerWeek',T('Часов экономии на человека в неделю (гипотеза)','Hours saved per person per week (assumption)'),0],
    ['hourCost',T('Стоимость часа','Hourly cost'),0],
    ['platformPerMonth',T('Стоимость платформы в месяц','Monthly platform cost'),0],
    ['implementationCost',T('Затраты на внедрение','Implementation cost'),0],
    ['months',T('Период распределения затрат, месяцев','Amortization period, months'),1],
  ];
  const moneyForm=moneyLabels.map(([key,label,min])=>`<label class="investor-input">${esc(label)}
    <input data-investor-input="${key}" inputmode="decimal" type="number" min="${min}" step="${min===1?1:'any'}" placeholder="—" /></label>`).join('');
  modal(T('Инвестиционный маршрут ChatX','ChatX investor walkthrough'),`
    <div class="investor-tour">
      <section class="surface investor-tour-hero">
        <div class="row-sub">${esc(isDemo?T('СИНТЕТИЧЕСКИЕ ДЕМО-ДАННЫЕ · НЕ КЛИЕНТСКИЕ РЕЗУЛЬТАТЫ','SYNTHETIC DEMO · NOT CUSTOMER RESULTS'):T('ДАННЫЕ ИЗ ТЕКУЩЕГО ПРОСТРАНСТВА · ПРОВЕРЯЙТЕ ИСТОЧНИК','CURRENT WORKSPACE DATA · VERIFY SOURCE'))}</div>
        <h3>${esc(T('От разговора до подтверждённого результата','From conversation to accountable delivery'))}</h3>
        <p class="muted">${esc(T('Нажимайте на шаги: откроются настоящие экраны и доступные вашему аккаунту объекты. Недоступные подтверждения не подменяются макетами.','Explore real screens and permission-scoped objects. Missing evidence is never replaced with fabricated figures.'))}</p>
      </section>
      <div class="investor-tour-stats">
        ${fmt(T('Открытые обязательства','Open commitments'),dashboard?.tasks?.totals?.open)}
        ${fmt(T('Просрочено','Overdue'),dashboard?.tasks?.totals?.overdue)}
        ${fmt(T('Закрыто за период','Closed in period'),dashboard?.tasks?.totals?.closed)}
        ${fmt(T('Задач в проекте, видимых вам','Visible project tasks'),project?.metrics?.visibleTasks)}
      </div>
      ${unavailable.length?`<p class="muted" role="status">${esc(unavailable.join(' · '))}</p>`:''}
      <div class="investor-tour-steps">${panels}</div>
      <section class="surface investor-tour-economics">
        <h3>${esc(T('Экономика: сценарный калькулятор','Economics: scenario calculator'))}</h3>
        <p class="muted">${esc(T('Введите собственные допущения. Модель НЕ измеряет достигнутый эффект, не прогнозирует продажи и не подтверждает ROI.','Enter your own assumptions. This is NOT observed savings or verified ROI.'))}</p>
        <div class="investor-tour-inputs">${moneyForm}</div>
        <div class="chip-row">
          <label>${esc(T('Валюта','Currency'))}<select data-investor-currency><option value="RUB">RUB</option><option value="USD">USD</option><option value="EUR">EUR</option></select></label>
          <button class="button secondary pressable" type="button" data-investor-calculate>${esc(T('Рассчитать сценарий','Calculate scenario'))}</button>
        </div>
        <p class="muted" data-investor-result role="status">${esc(T('Расчёт появится только после заполнения всех полей.','Complete all inputs to calculate.'))}</p>
        <p class="row-sub">${esc(T('Формула: сотрудники × часы/неделю × стоимость часа × 52/12 − ежемесячный тариф − затраты на внедрение / месяцы.','Formula: people × hours/week × hourly cost × 52/12 − monthly fee − implementation cost / months.'))}</p>
      </section>
      <p class="row-sub">${esc(T('Источник показателей: GET /api/v1/dashboard; проект: GET /api/v1/projects/:id. Цифры отражают видимость вашей роли, а не всю организацию.','Sources: GET /api/v1/dashboard and /api/v1/projects/:id. Figures respect the current user’s access.'))}</p>
    </div>`,()=>{
    const result=document.querySelector('[data-investor-result]');
    document.querySelector('[data-investor-calculate]')?.addEventListener('click',()=>{
      const fields={};
      document.querySelectorAll('[data-investor-input]').forEach(node=>fields[node.dataset.investorInput]=node.value);
      const estimate=hypotheticalEconomics(fields);
      if(!estimate){result.textContent=T('Проверьте все допущения. Поля не могут быть пустыми или отрицательными.','Check all assumptions; no field may be blank or negative.');return;}
      const currency=document.querySelector('[data-investor-currency]')?.value||'RUB';
      const fmtMoney=v=>new Intl.NumberFormat('ru-RU',{style:'currency',currency,maximumFractionDigits:0}).format(v);
      result.textContent=`${T('Условная валовая ценность/мес.','Hypothetical gross value/month')}: ${fmtMoney(estimate.monthlyGross)}. ${T('Условный чистый эффект/мес.','Hypothetical net value/month')}: ${fmtMoney(estimate.monthlyNet)}. ${T('Условный срок окупаемости внедрения','Hypothetical implementation payback')}: ${estimate.paybackMonths===null?T('не достигается','not reached'):estimate.paybackMonths.toFixed(1)+' '+T('мес.','months')}.`;
    });
  });
}
