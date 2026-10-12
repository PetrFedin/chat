// Pages v1: render the server's canonical ProseMirror JSON as DOM, never as HTML.
// A page title or text must not become markup, even if a future API bypasses normalization.
const tags = Object.freeze({
  paragraph: 'p', heading: 'h2', bulletList: 'ul', orderedList: 'ol',
  listItem: 'li', blockquote: 'blockquote', codeBlock: 'pre',
  horizontalRule: 'hr',
});
const marks = Object.freeze({ bold: 'strong', italic: 'em', underline: 'u', strike: 's', code: 'code', link: 'a' });
const allowedNodes = new Set(['doc', 'paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'codeBlock', 'horizontalRule', 'text', 'hardBreak']);
const allowedMarks = new Set(Object.keys(marks));

export function safePageHref(href) {
  const value = typeof href === 'string' ? href.trim() : '';
  return /^(https?:\/\/[^\s<>"']+|mailto:[^\s<>"']+|#\/[a-z0-9\/_?=&.%-]+)$/i.test(value) && value.length <= 2048 ? value : null;
}

export function textPageDocument(text = '') {
  return {
    type: 'doc',
    content: String(text).split('\n').map(line => ({
      type: 'paragraph',
      ...(line ? { content: [{ type: 'text', text: line }] } : {}),
    })),
  };
}

// Tiptap adds presentation-only attrs (e.g. rel/target) when reading a link.
// Strip them before hitting the strict server schema. Unknown node/mark: reject,
// never silently flatten an existing rich document.
export function canonicalEditorDocument(source) {
  let total = 0;
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || !allowedNodes.has(node.type) || depth > 20 || ++total > 3000) {
      throw new Error('Некорректная структура документа');
    }
    if (node.type === 'text') {
      if (typeof node.text !== 'string' || !node.text.length) throw new Error('Пустой текстовый узел');
      const result = { type: 'text', text: node.text };
      if (node.marks?.length) {
        result.marks = node.marks.map(mark => {
          if (!allowedMarks.has(mark.type)) throw new Error('Недопустимый формат текста');
          if (mark.type !== 'link') return { type: mark.type };
          const href = safePageHref(mark.attrs?.href);
          if (!href) throw new Error('Ссылка должна быть HTTP(S), mailto: или внутренней ссылкой ChatX');
          return { type: 'link', attrs: { href } };
        });
      }
      return result;
    }
    const out = { type: node.type };
    if (node.type === 'heading') {
      const level = node.attrs?.level;
      if (![1, 2, 3].includes(level)) throw new Error('Недопустимый уровень заголовка');
      out.attrs = { level };
    } else if (node.type === 'orderedList') {
      const start = node.attrs?.start ?? 1;
      if (!Number.isSafeInteger(start) || start < 1 || start > 100000) throw new Error('Неверная нумерация списка');
      out.attrs = { start };
    }
    if (Array.isArray(node.content) && node.content.length) out.content = node.content.map(child => walk(child, depth + 1));
    return out;
  };
  if (source?.type !== 'doc') throw new Error('Документ должен иметь корневой узел doc');
  return walk(source, 0);
}

function renderNode(node, depth = 0) {
  const fragment = document.createDocumentFragment();
  if (!node || !allowedNodes.has(node.type) || depth > 20) return fragment;
  if (node.type === 'text') {
    let result = document.createTextNode(String(node.text ?? ''));
    for (const mark of (Array.isArray(node.marks) ? node.marks : []).slice().reverse()) {
      if (!allowedMarks.has(mark.type)) continue;
      if (mark.type === 'link' && !safePageHref(mark.attrs?.href)) continue;
      const wrapper = document.createElement(marks[mark.type]);
      if (mark.type === 'link') {
        wrapper.setAttribute('href', safePageHref(mark.attrs.href));
        wrapper.setAttribute('rel', 'noopener noreferrer nofollow');
        if (!mark.attrs.href.startsWith('#/')) wrapper.setAttribute('target', '_blank');
      }
      wrapper.appendChild(result);
      result = wrapper;
    }
    return result;
  }
  if (node.type === 'hardBreak') return document.createElement('br');
  let element = fragment;
  if (tags[node.type]) {
    let tag = tags[node.type];
    if (node.type === 'heading' && [1, 2, 3].includes(node.attrs?.level)) tag = 'h' + node.attrs.level;
    element = document.createElement(tag);
    if (node.type === 'orderedList') element.start = Number.isSafeInteger(node.attrs?.start) ? node.attrs.start : 1;
  }
  const target = node.type === 'codeBlock' ? document.createElement('code') : element;
  for (const child of (Array.isArray(node.content) ? node.content : [])) target.appendChild(renderNode(child, depth + 1));
  if (node.type === 'codeBlock') element.appendChild(target);
  return element;
}

export function renderPageDocument(root, doc, emptyLabel = 'Страница пока пуста') {
  if (!root) return;
  const tree = renderNode(doc);
  root.replaceChildren(tree);
  if (!root.textContent.trim() && !root.querySelector('hr')) {
    const placeholder = document.createElement('p');
    placeholder.className = 'muted';
    placeholder.textContent = emptyLabel;
    root.replaceChildren(placeholder);
  }
}
