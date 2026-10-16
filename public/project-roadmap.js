// CHATX Project Timeline. Static projection only; all mutations are routed
// to the canonical Project/Task authorities by the surrounding app.
(function(){
  'use strict';
  const DAY=86400000;
  const iso=(value)=>String(value||'').slice(0,10);
  const dateMs=(value)=>Date.parse(iso(value)+'T00:00:00.000Z');
  const safeDate=(value)=>Number.isFinite(dateMs(value));
  const addDays=(date,n)=>new Date(dateMs(date)+n*DAY).toISOString().slice(0,10);
  const monday=(date)=>{
    const d=new Date(dateMs(date));
    return addDays(date,-(d.getUTCDay()+6)%7);
  };
  const monthIndex=(date)=>{const d=new Date(dateMs(date));return d.getUTCFullYear()*12+d.getUTCMonth()};
  const axisLabel=(date,lang,unit)=>new Intl.DateTimeFormat(lang==='en'?'en-GB':'ru-RU',
    {month:'short',...(unit==='week'?{day:'numeric'}:{year:'2-digit'}),timeZone:'UTC'}
  ).format(new Date(date+'T00:00:00.000Z'));
  const pad=(value)=>String(value).padStart(2,'0');
  const firstOfMonth=date=>{
    const dt=new Date(dateMs(date));return dt.getUTCFullYear()+'-'+pad(dt.getUTCMonth()+1)+'-01';
  };
  const addMonths=(date,n)=>{
    const d=new Date(dateMs(date));d.setUTCMonth(d.getUTCMonth()+n);
    return d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-01';
  };
  function render(project,T,esc,lang){
    const plan=project.plan||{};
    const phases=plan.phases||[];
    const schedules=plan.schedules||[];
    const dependencies=plan.dependencies||[];
    const visibleTasks=project.tasks||[];
    const taskById=new Map(visibleTasks.map(item=>[item.id,item]));
    const scheduleById=new Map(schedules.map(item=>[item.taskId,item]));
    const violations=new Set((plan.violations||[]).map(item=>item.successorTaskId));
    const allDates=[
      project.startAt,project.targetAt,
      ...phases.flatMap(item=>[item.startAt,item.endAt]),
      ...schedules.flatMap(item=>[item.plannedStart,item.plannedEnd]),
      ...(project.milestones||[]).map(item=>item.targetAt),
    ].map(iso).filter(safeDate).sort();
    const today=new Date().toISOString().slice(0,10);
    const begin=allDates[0]||today;
    const finish=allDates[allDates.length-1]||addDays(today,84);
    const start=monday(begin);
    const weeks=Math.floor((dateMs(finish)-dateMs(start))/(DAY*7))+1;
    const unit=weeks>60?'month':'week';
    const anchor=unit==='month'?firstOfMonth(start):start;
    const cell=unit==='month'?60:48;
    const rawCount=unit==='month'
      ?monthIndex(finish)-monthIndex(anchor)+1
      :Math.floor((dateMs(finish)-dateMs(anchor))/(DAY*7))+1;
    const count=Math.min(120,Math.max(8,rawCount));
    const clipWarning=rawCount>120;
    const index=date=>{
      if(!safeDate(date))return null;
      return unit==='month'?monthIndex(date)-monthIndex(anchor)
        :Math.floor((dateMs(date)-dateMs(anchor))/(DAY*7));
    };
    const axis=Array.from({length:count},(_,i)=>{
      const date=unit==='week'?addDays(anchor,i*7):addMonths(anchor,i);
      return '<span class="project-roadmap-tick">'+esc(axisLabel(date,lang,unit))+'</span>';
    }).join('');
    const totals={
      phases:phases.length,scheduled:schedules.length,
      unplanned:visibleTasks.filter(task=>!scheduleById.has(task.id)).length,
      risk:(plan.violations||[]).length,
    };
    const help=T(
      'Временная шкала и зависимости — план; состояние выполнения всегда берётся из задач CHATX.',
      'The timeline and dependencies represent planning; task execution status always comes from CHATX Tasks.'
    );
    const header='<div class="project-roadmap-row project-roadmap-head">'+
      '<div class="project-roadmap-label">'+T('Работа / этап','Work / phase')+'</div>'+
      '<div class="project-roadmap-axis">'+axis+'</div></div>';
    const bar=(from,to,kind,atRisk)=>{
      const left=index(from),right=index(to);
      if(left===null||right===null||right<0||left>=count)return '';
      const visibleLeft=Math.max(0,left);
      const visibleRight=Math.min(count-1,right);
      const span=visibleRight-visibleLeft+1;
      return '<span class="project-roadmap-bar project-roadmap-bar-'+kind+(atRisk?' at-risk':'')+
        '" style="--bar-start:'+visibleLeft+';--bar-span:'+span+'" aria-hidden="true"></span>';
    };
    const row=(label,meta,from,to,kind,identifier,risk)=>{
      const clickable=kind==='phase'?(project.canManage?' data-project-plan-phase-edit="'+esc(identifier)+'"':''):
        kind==='task'?(project.canContribute?' data-project-plan-task="'+esc(identifier)+'"':''):'';
      const name=clickable
        ?'<button type="button" class="project-roadmap-name"'+clickable+'>'+esc(label)+'</button>'
        :'<span class="project-roadmap-name">'+esc(label)+'</span>';
      return '<div class="project-roadmap-row project-roadmap-'+kind+'" data-project-roadmap-row="'+esc(identifier)+'">'+
        '<div class="project-roadmap-label">'+name+'<small>'+esc(meta)+'</small></div>'+
        '<div class="project-roadmap-track">'+bar(from,to,kind,risk)+'</div></div>';
    };
    const rows=[];
    const showTask=schedule=>{
      const task=taskById.get(schedule.taskId);
      if(!task)return;
      const minutes=Number(schedule.estimateMinutes||0);
      const meta=(task.status||'')+' · '+(task.ownerName||'')+(minutes?' · '+minutes+' min':'')+
        (violations.has(task.id)?' · '+T('конфликт сроков','date conflict'):'');
      rows.push(row(task.title,meta,schedule.plannedStart,schedule.plannedEnd,'task',task.id,violations.has(task.id)));
    };
    const shown=new Set();
    for(const phase of phases){
      rows.push(row(phase.title,phase.startAt+' — '+phase.endAt,
        phase.startAt,phase.endAt,'phase',phase.id,false));
      for(const schedule of schedules.filter(item=>item.phaseId===phase.id)){
        shown.add(schedule.taskId);showTask(schedule);
      }
    }
    for(const schedule of schedules){
      if(shown.has(schedule.taskId))continue;
      showTask(schedule);
    }
    if(!rows.length){
      rows.push('<div class="project-roadmap-empty">'+T(
        'Фазы и сроки пока не заданы. Начните с этапа проекта или запланируйте задачу.',
        'No phases or task schedules yet. Create a phase or schedule a task.'
      )+'</div>');
    }
    const unplanned=visibleTasks.filter(task=>!scheduleById.has(task.id));
    const unplannedHtml=unplanned.length
      ?'<div class="project-roadmap-unplanned"><strong>'+T('Без срока','Unscheduled')+
        ' · '+unplanned.length+'</strong><div class="project-roadmap-actions">'+
        unplanned.slice(0,15).map(task=>project.canContribute
          ?'<button type="button" class="chipbtn" data-project-plan-task="'+esc(task.id)+'">'+esc(task.title)+'</button>'
          :'<span class="chip">'+esc(task.title)+'</span>').join('')+
        (unplanned.length>15?'<span class="muted">'+T('Показаны первые 15','First 15 shown')+'</span>':'')+
        '</div></div>':'';
    const depHtml=dependencies.length
      ?'<div class="project-roadmap-deps"><strong>'+T('Связи задач','Dependencies')+'</strong>'+
        dependencies.map(item=>{
          const first=taskById.get(item.predecessorTaskId);
          const second=taskById.get(item.successorTaskId);
          if(!first||!second)return '';
          const risky=violations.has(second.id);
          return '<div class="project-roadmap-dep'+(risky?' at-risk':'')+'">'+
            '<span>'+esc(first.title)+' → '+esc(second.title)+
            (item.lagDays?' · +'+Number(item.lagDays)+' '+T('дн.','days'):'')+
            (risky?' · '+T('конфликт дат','date conflict'):'')+'</span>'+
            (project.canContribute?'<button type="button" class="text-button" data-project-plan-dep-remove="'+
              esc(first.id)+'" data-project-plan-dep-target="'+esc(second.id)+'" aria-label="'+
              esc(T('Удалить зависимость','Remove dependency'))+'">×</button>':'')+'</div>';
        }).join('')+'</div>':'';
    return '<section class="surface project-roadmap-section">'+
      '<div class="section-head"><div><h3>'+T('Дорожная карта проекта','Project roadmap')+'</h3>'+
      '<p class="muted">'+help+'</p></div><div class="project-roadmap-actions">'+
      (project.canManage?'<button type="button" class="button secondary small" data-project-plan-new-phase>＋ '+
         T('Этап','Phase')+'</button>':'')+
      (project.canContribute?'<button type="button" class="button secondary small" data-project-plan-dependency>＋ '+
         T('Связь задач','Dependency')+'</button>':'')+'</div></div>'+
      '<div class="project-roadmap-summary"><span>'+totals.phases+' '+T('этапов','phases')+'</span>'+
      '<span>'+totals.scheduled+' '+T('запланировано','scheduled')+'</span>'+
      '<span>'+totals.unplanned+' '+T('без срока','unscheduled')+'</span>'+
      (totals.risk?'<span class="project-roadmap-risk">'+totals.risk+' '+T('конфликтов','date conflicts')+'</span>':'')+'</div>'+
      '<div class="project-roadmap-scroll" role="region" tabindex="0" aria-label="'+
      esc(T('Прокручиваемая временная шкала проекта','Scrollable project timeline'))+'">'+
      '<div class="project-roadmap-canvas" style="--timeline-cell:'+cell+'px;--timeline-count:'+count+'">'+
      header+rows.join('')+'</div></div>'+
      (clipWarning?'<p class="muted">'+T('Показаны первые 120 периодов; полный план сохранён.',
        'Showing the first 120 periods; the complete plan is preserved.')+'</p>':'')+
      unplannedHtml+depHtml+'</section>';
  }
  window.ChatProjectRoadmap=Object.freeze({render});
})();
