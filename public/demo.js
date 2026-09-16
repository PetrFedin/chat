const access = document.getElementById('demo-access');
const button = document.getElementById('demo-login');
const errorNode = document.getElementById('auth-error');

async function checkDemo() {
  if (!access || !button || new URLSearchParams(location.search).has('invite')) return;
  try {
    const response = await fetch('/api/v1/demo', { credentials: 'same-origin' });
    if (!response.ok) return;
    const payload = await response.json();
    if (payload.enabled) access.hidden = false;
  } catch {}
}

button?.addEventListener('click', async () => {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Открываем демо…';
  if (errorNode) errorNode.textContent = '';
  try {
    const response = await fetch('/api/v1/auth/demo', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || 'Не удалось открыть демо');
    location.assign('/');
  } catch (error) {
    button.disabled = false;
    button.textContent = original;
    if (errorNode) errorNode.textContent = error.message;
  }
});

checkDemo();
