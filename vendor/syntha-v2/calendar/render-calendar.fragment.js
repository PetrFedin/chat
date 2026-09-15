function renderCalendar() {
  const items = [...state.workspace.calendar].sort((a,b)=>String(a.startsAt).localeCompare(String(b.startsAt)));
  return sectionCard(
    '\u041e\u0431\u0449\u0438\u0439 \u043a\u0430\u043b\u0435\u043d\u0434\u0430\u0440\u044c',
    items.length ? items.map(calendarEntity) : [empty('\u0421\u043e\u0431\u044b\u0442\u0438\u0439 \u043f\u043e\u043a\u0430 \u043d\u0435\u0442.')],
    undefined,
    undefined,
    'calendar',
  );
}
