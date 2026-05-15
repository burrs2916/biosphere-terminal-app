import { Node, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    bookmark: {
      setBookmark: (attrs?: { href?: string; title?: string; description?: string }) => ReturnType;
    };
  }
}

export const BookmarkExtension = Node.create({
  name: 'bookmark',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      href: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-href') || '',
        renderHTML: (attrs) => ({ 'data-href': attrs.href }),
      },
      title: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-title') || '',
        renderHTML: (attrs) => ({ 'data-title': attrs.title }),
      },
      description: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-description') || '',
        renderHTML: (attrs) => ({ 'data-description': attrs.description }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-bookmark]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const href = HTMLAttributes['data-href'] || '';
    const title = HTMLAttributes['data-title'] || href;
    const description = HTMLAttributes['data-description'] || '';

    const displayUrl = (() => {
      try {
        return new URL(href).hostname;
      } catch {
        return href;
      }
    })();

    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-bookmark': '',
        style:
          'border: 1px solid rgba(48,54,61,0.6); border-radius: 8px; padding: 12px 16px; margin: 12px 0; display: flex; gap: 12px; align-items: center; background: rgba(22,27,34,0.4); cursor: pointer; transition: border-color 0.2s;',
        onmouseover: "this.style.borderColor='#6C63FF'",
        onmouseout: "this.style.borderColor='rgba(48,54,61,0.6)'",
      }),
      [
        'span',
        { style: 'font-size: 1.5em; flex-shrink: 0;' },
        '🔗',
      ],
      [
        'div',
        { style: 'flex: 1; min-width: 0;' },
        ['div', { style: 'font-weight: 600; color: #E6EDF3; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;' }, title],
        description
          ? ['div', { style: 'font-size: 0.85em; color: #8B949E; margin-bottom: 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;' }, description]
          : ['span'],
        ['div', { style: 'font-size: 0.8em; color: #6C63FF;' }, displayUrl],
      ],
    ];
  },

  addCommands() {
    return {
      setBookmark:
        (attrs) =>
        ({ commands }) => {
          const href = attrs?.href || window.prompt('Enter URL:') || '';
          if (!href) return false;
          const title = attrs?.title || window.prompt('Enter title (optional):') || '';
          const description = attrs?.description || '';
          return commands.insertContent({
            type: 'bookmark',
            attrs: { href, title, description },
          });
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-b': () => this.editor.commands.setBookmark(),
    };
  },
});