import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import { canonicalEditorDocument, textPageDocument } from './wiki-document-view.js';

export function mountWikiEditor({ element, toolbar, document: initial, onDirty }) {
  if (!element) throw new Error('Pages editor mount is missing');
  const editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
      Underline,
      Link.configure({ openOnClick: false, autolink: false, protocols: ['http', 'https', 'mailto'] }),
    ],
    content: canonicalEditorDocument(initial ?? textPageDocument('')),
    onUpdate: () => onDirty?.(true),
    editorProps: {
      attributes: { class: 'wiki-rich-content', 'aria-label': 'Текст страницы' },
      transformPastedHTML: html => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''),
    },
  });
  const commands = {
    paragraph: () => editor.chain().focus().setParagraph().run(),
    h1: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    h2: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    h3: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    bold: () => editor.chain().focus().toggleBold().run(),
    italic: () => editor.chain().focus().toggleItalic().run(),
    underline: () => editor.chain().focus().toggleUnderline().run(),
    strike: () => editor.chain().focus().toggleStrike().run(),
    code: () => editor.chain().focus().toggleCode().run(),
    bullet: () => editor.chain().focus().toggleBulletList().run(),
    numbered: () => editor.chain().focus().toggleOrderedList().run(),
    quote: () => editor.chain().focus().toggleBlockquote().run(),
    codeblock: () => editor.chain().focus().toggleCodeBlock().run(),
    rule: () => editor.chain().focus().setHorizontalRule().run(),
    undo: () => editor.chain().focus().undo().run(),
    redo: () => editor.chain().focus().redo().run(),
    link: () => {
      const value = window.prompt('https://… или #/…');
      if (value === null) return;
      if (!value.trim()) return editor.chain().focus().unsetLink().run();
      const href = value.trim();
      if (!/^(https?:\/\/[^\s<>"']+|mailto:[^\s<>"']+|#\/[a-z0-9\/_?=&.%-]+)$/i.test(href)) {
        throw new Error('Используйте безопасную HTTP(S), mailto или внутреннюю ссылку');
      }
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    },
  };
  toolbar?.addEventListener('click', event => {
    const button = event.target.closest('[data-format]');
    if (!button || !toolbar.contains(button)) return;
    event.preventDefault();
    try { commands[button.dataset.format]?.(); }
    catch (error) { window.dispatchEvent(new CustomEvent('chat:wiki-editor-error', { detail: error.message })); }
  });
  return {
    getDocument: () => canonicalEditorDocument(editor.getJSON()),
    focus: () => editor.commands.focus(),
    destroy: () => editor.destroy(),
  };
}
