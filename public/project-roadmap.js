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
    const prediction=plan.forecast;
    const forecastHtml=prediction&&prediction.status!=='empty'
      ?'<div class="project-forecast-summary" data-project-forecast>'+
        '<strong>'+T('Прогноз по связям задач','Dependency-based forecast')+'</strong>'+
        '<span>'+T('Завершение','Finish')+': '+esc(prediction.forecastFinishAt||T('Не рассчитано','Unavailable'))+'</span>'+
        (prediction.targetGapDays===null?'':'<span>'+T('Отклонение от цели, дней','Days versus target')+
          ': '+esc(String(prediction.targetGapDays))+'</span>')+
        '<span>'+T('Критические задачи','Critical tasks')+': '+
          Number(prediction.criticalTaskIds?.length||0)+'</span>'+
        (prediction.status==='partial'?'<span class="project-forecast-partial">'+
          T('Неполные данные: часть задач без графика.','Partial: some tasks are unscheduled.')+
          '</span>':'')+
        '<small>'+T('Календарные дни; без учёта отпусков и загрузки команды.',
          'Calendar days; excludes holidays and resource capacity.')+'</small>'+
      '</div>':'';
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
      forecastHtml+unplannedHtml+depHtml+'</section>';
  }

  // Form actions are explicitly delegated back to the host app. Project and
  // Task permissions are enforced again by the server on every mutation.
  function bind({project,api,modal,closeModal,toast,T,esc,confirmTap,refresh}){
    if(!project||!document.querySelector('.project-roadmap-section'))return;
    const one=(selector)=>document.querySelector(selector);
    const many=(selector)=>Array.from(document.querySelectorAll(selector));
    const base='/api/v1/projects/'+project.id+'/plan';
    const p=project.plan||{};
    const tasks=project.tasks||[];
    const isoDate=value=>String(value||'').slice(0,10);
    const today=new Date().toISOString().slice(0,10);
    const defaultStart=isoDate(project.startAt)||today;
    const defaultEnd=isoDate(project.targetAt)||today;
    const handleError=error=>toast(error?.code==='PLAN_VERSION_CONFLICT'
      ?T('План изменён другим участником. Закройте форму и обновите проект.',
        'Another person changed this plan. Close the form and refresh the project.')
      :(error.message||T('Не удалось сохранить план','Could not save plan')));
    const save=async(button,work)=>{
      button.disabled=true;
      try{
        await work();
        closeModal();
        await refresh(project.id);
      }catch(error){handleError(error);button.disabled=false;}
    };
    const label=(caption,name,type,value,additional='')=>
      '<label>'+caption+'<input name="'+name+'" type="'+type+'" value="'+esc(value||'')+'" '+additional+'></label>';

    const phaseModal=phaseId=>{
      if(!project.canManage)return;
      const phase=(p.phases||[]).find(x=>x.id===phaseId);
      const edit=Boolean(phase);
      const fields='<form id="project-plan-phase-form" class="form-stack">'+
        label(T('Название этапа','Phase title'),'title','text',phase?.title||'','maxlength="160" required')+
        label(T('Начало','Start'),'startAt','date',phase?.startAt||defaultStart,'required')+
        label(T('Окончание','Finish'),'endAt','date',phase?.endAt||defaultEnd,'required')+
        '<p class="muted">'+T(
          'Этап определяет плановый интервал, но не меняет сроки задач автоматически.',
          'A phase defines a planned interval but does not silently reschedule tasks.'
        )+'</p><button class="button primary" type="submit">'+
        (edit?T('Сохранить этап','Save phase'):T('Создать этап','Create phase'))+
        '</button></form>';
      modal(edit?T('Редактировать этап','Edit phase'):T('Новый этап','New phase'),fields,()=>{
        const form=one('#project-plan-phase-form');
        if(!form)return;
        form.onsubmit=event=>{
          event.preventDefault();
          const data=Object.fromEntries(new FormData(form));
          if(edit)data.expectedVersion=phase.version;
          save(form.querySelector('[type="submit"]'),async()=>{
            await api(edit?base+'/phases/'+phase.id:base+'/phases',{
              method:edit?'PATCH':'POST',body:JSON.stringify(data),
            });
          });
        };
      });
    };

    const taskModal=taskId=>{
      if(!project.canContribute)return;
      const task=tasks.find(x=>x.id===taskId);
      if(!task)return;
      const schedule=(p.schedules||[]).find(x=>x.taskId===taskId);
      const phases=p.phases||[];
      const options='<option value="">'+T('Без этапа','No phase')+'</option>'+
        phases.map(phase=>'<option value="'+esc(phase.id)+'"'+
          (schedule?.phaseId===phase.id?' selected':'')+'>'+esc(phase.title)+'</option>').join('');
      const html='<form id="project-plan-task-form" class="form-stack">'+
        '<p class="muted">'+esc(task.title)+' · '+
        T('Это только план. Статус и исполнитель остаются в Tasks.',
          'This is only a schedule. Task status and assignee stay in Tasks.')+'</p>'+
        '<label>'+T('Этап','Phase')+'<select name="phaseId">'+options+'</select></label>'+
        label(T('Плановое начало','Planned start'),'plannedStart','date',
          schedule?.plannedStart||defaultStart,'required')+
        label(T('Плановое завершение','Planned finish'),'plannedEnd','date',
          schedule?.plannedEnd||defaultEnd,'required')+
        label(T('Оценка трудозатрат, минут','Effort estimate, minutes'),
          'estimateMinutes','number',String(schedule?.estimateMinutes??0),
          'min="0" max="1000000" step="1" required')+
        '<button class="button primary" type="submit">'+T('Сохранить план задачи','Save task plan')+
        '</button></form>';
      modal(T('Планирование задачи','Task scheduling'),html,()=>{
        const form=one('#project-plan-task-form');
        if(!form)return;
        form.onsubmit=event=>{
          event.preventDefault();
          const data=Object.fromEntries(new FormData(form));
          const body={
            plannedStart:data.plannedStart,plannedEnd:data.plannedEnd,
            phaseId:data.phaseId||null,estimateMinutes:Number(data.estimateMinutes),
            expectedVersion:schedule?.version??0,
          };
          save(form.querySelector('[type="submit"]'),async()=>{
            await api(base+'/tasks/'+task.id,{method:'PUT',body:JSON.stringify(body)});
          });
        };
      });
    };

    const dependencyModal=()=>{
      if(!project.canContribute)return;
      if(tasks.length<2)return toast(T('Нужно хотя бы две задачи проекта',
        'At least two project tasks are required'));
      const options=tasks.map(task=>'<option value="'+esc(task.id)+'">'+
        esc(task.title)+'</option>').join('');
      const html='<form id="project-plan-dep-form" class="form-stack">'+
        '<label>'+T('Сначала выполнить','Predecessor task')+
          '<select name="predecessorTaskId" required>'+options+'</select></label>'+
        '<label>'+T('Затем выполнить','Successor task')+
          '<select name="successorTaskId" required>'+options+'</select></label>'+
        label(T('Пауза после первой задачи, дней','Lag, whole days'),'lagDays','number',
          '0','min="0" max="365" step="1" required')+
        '<p class="muted">'+T(
          'Циклические зависимости запрещены. Плановые конфликты дат будут видны на шкале.',
          'Cyclic dependencies are prohibited. Date conflicts are highlighted on the timeline.'
        )+'</p><button class="button primary" type="submit">'+
        T('Добавить зависимость','Add dependency')+'</button></form>';
      modal(T('Зависимость задач','Task dependency'),html,()=>{
        const form=one('#project-plan-dep-form');
        if(!form)return;
        const select=form.querySelector('[name="successorTaskId"]');
        if(select&&tasks.length>1)select.value=tasks[1].id;
        form.onsubmit=event=>{
          event.preventDefault();
          const data=Object.fromEntries(new FormData(form));
          data.lagDays=Number(data.lagDays);
          save(form.querySelector('[type="submit"]'),async()=>{
            await api(base+'/dependencies',{method:'POST',body:JSON.stringify(data)});
          });
        };
      });
    };

    many('[data-project-plan-new-phase]').forEach(button=>
      button.onclick=()=>phaseModal(null));
    many('[data-project-plan-phase-edit]').forEach(button=>
      button.onclick=()=>phaseModal(button.dataset.projectPlanPhaseEdit));
    many('[data-project-plan-task]').forEach(button=>
      button.onclick=()=>taskModal(button.dataset.projectPlanTask));
    many('[data-project-plan-dependency]').forEach(button=>
      button.onclick=dependencyModal);
    many('[data-project-plan-dep-remove]').forEach(button=>
      button.onclick=()=>confirmTap(button,async()=>{
        button.disabled=true;
        try{
          await api(base+'/dependencies/'+button.dataset.projectPlanDepRemove+
            '/'+button.dataset.projectPlanDepTarget,{method:'DELETE'});
          await refresh(project.id);
        }catch(error){handleError(error);button.disabled=false;}
      },T('Удалить зависимость?','Remove dependency?')));
  }

  window.ChatProjectRoadmap=Object.freeze({render,bind});
})();
