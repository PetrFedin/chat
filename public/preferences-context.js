(() => {
  const pairs = [
    ['#register-form input[name="companyName"]', 'placeholder', 'Название компании', 'Company name'],
    ['#register-form input[name="ownerName"]', 'placeholder', 'Имя и фамилия', 'Full name'],
    ['#accept-invite-form input[name="displayName"]', 'placeholder', 'Имя и фамилия', 'Full name'],
    ['#register-form input[name="password"]', 'placeholder', 'Не менее 12 символов и цифра', 'At least 12 characters and a number'],
    ['#accept-invite-form input[name="password"]', 'placeholder', 'Не менее 12 символов и цифра', 'At least 12 characters and a number'],
    ['.quick-bar input', 'placeholder', 'Сообщение, задача или встреча…', 'Message, task or meeting…'],
  ];

  function apply() {
    const locale = window.ChatPreferences?.locale || 'ru';
    for (const [selector, attribute, ru, en] of pairs) {
      document.querySelectorAll(selector).forEach((node) => node.setAttribute(attribute, locale === 'en' ? en : ru));
    }
  }

  window.addEventListener('chat:localechange', apply);
  new MutationObserver(apply).observe(document.documentElement, { childList:true, subtree:true });
  apply();
})();
