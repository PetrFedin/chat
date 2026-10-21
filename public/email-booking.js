const token = location.pathname.split('/').filter(Boolean).at(-1);
const content = document.querySelector('#booking-content'), status = document.querySelector('#booking-status'), title = document.querySelector('#booking-title');
const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const submissionId = crypto.randomUUID();
let booking, timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const stamp = date => new Intl.DateTimeFormat('ru', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date));
function announce(text, failed = false) { status.textContent = text; status.toggleAttribute('data-error', failed); }
async function request(input) {
  const response = await fetch(`/api/v1/email-booking/${token}`, { credentials: 'omit', headers: input ? { 'content-type': 'application/json' } : {}, method: input ? 'POST' : 'GET', body: input ? JSON.stringify(input) : undefined });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error?.message || 'Не удалось получить ответ. Попробуйте ещё раз.'), { code: value.error?.code });
  return value;
}
function calendarFile(result) {
  const text = value => String(value).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const utc = value => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ChatX//Booking//RU', 'BEGIN:VEVENT', `UID:${result.calendarEventId}@chatx`, `DTSTAMP:${utc(new Date())}`, `DTSTART:${utc(result.startAt)}`, `DTEND:${utc(result.endAt)}`, `SUMMARY:${text(result.title)}`, 'END:VEVENT', 'END:VCALENDAR'];
  const url = URL.createObjectURL(new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'chatx-meeting.ics'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function receipt(result) {
  title.textContent = 'Встреча запланирована'; announce('Время сохранено в календаре организатора.');
  content.innerHTML = `<div class="booking-receipt"><p class="booking-success" aria-hidden="true">✓</p><strong>${esc(result.title)}</strong><p>${esc(stamp(result.startAt))} — ${esc(new Intl.DateTimeFormat('ru', { timeZone: timezone, timeStyle: 'short' }).format(new Date(result.endAt)))}</p><p class="booking-timezone">${esc(timezone)}</p><button type="button" id="booking-ics">Добавить в мой календарь</button></div>`;
  document.querySelector('#booking-ics').onclick = () => calendarFile(result);
}
function renderForm() {
  if (!booking.slots.length) { announce('Свободных интервалов пока нет. Попросите организатора предложить другое время.'); content.innerHTML = '<button type="button" id="booking-reload" class="secondary">Проверить ещё раз</button>'; document.querySelector('#booking-reload').onclick = load; return; }
  const zones = [...new Set([timezone, booking.timezone, 'UTC'])];
  content.innerHTML = `<form id="booking-form"><label>Часовой пояс<select name="timezone">${zones.map(zone => `<option ${zone === timezone ? 'selected' : ''}>${esc(zone)}</option>`).join('')}</select></label><fieldset><legend>Выберите начало встречи</legend>${booking.slots.map((slot, index) => `<label class="slot"><input type="radio" name="startAt" value="${esc(slot.startAt)}" ${index === 0 ? 'checked' : ''} required><span>${esc(stamp(slot.startAt))} · ${Math.round((new Date(slot.endAt) - new Date(slot.startAt)) / 60000)} мин</span></label>`).join('')}</fieldset><label>Как вас зовут<input name="name" autocomplete="name" maxlength="120" required></label><label>Ваш email<input name="email" type="email" autocomplete="email" maxlength="254" required></label><button type="submit">Подтвердить время</button></form>`;
  const form = document.querySelector('#booking-form');
  form.elements.timezone.onchange = event => {
    const saved = { name: form.elements.name.value, email: form.elements.email.value, startAt: new FormData(form).get('startAt') };
    timezone = event.target.value; renderForm(); const next = document.querySelector('#booking-form'); next.elements.name.value = saved.name; next.elements.email.value = saved.email; for (const radio of next.querySelectorAll('[name="startAt"]')) radio.checked = radio.value === saved.startAt;
  };
  form.onsubmit = async event => {
    event.preventDefault(); const button = form.querySelector('[type="submit"]'); button.disabled = true; announce('Сохраняем выбранное время…');
    try {
      const data = new FormData(form), result = await request({ name: data.get('name'), email: data.get('email'), startAt: data.get('startAt'), submissionId });
      try { sessionStorage.setItem(`chatx-booking:${token}`, JSON.stringify(result)); } catch {}
      receipt(result);
    } catch (error) { announce(error.message, true); button.disabled = false; }
  };
}
async function load() {
  content.setAttribute('aria-busy', 'true');
  try {
    booking = await request(); title.textContent = booking.title;
    if (booking.status === 'booked') {
      let saved; try { saved = JSON.parse(sessionStorage.getItem(`chatx-booking:${token}`)); } catch {}
      if (saved?.booked) receipt(saved); else { announce('По этой ссылке время уже выбрано.'); content.replaceChildren(); }
    } else { announce('Выберите удобное время — доступность проверится ещё раз при подтверждении.'); renderForm(); }
  } catch (error) { title.textContent = 'Время встречи'; announce(error.message, true); content.replaceChildren(); }
  finally { content.setAttribute('aria-busy', 'false'); }
}
load();
