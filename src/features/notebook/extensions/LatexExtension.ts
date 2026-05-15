import { Node, mergeAttributes } from '@tiptap/core';
import katex from 'katex';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    latex: {
      setLatex: (expression?: string) => ReturnType;
    };
  }
}

export const LatexExtension = Node.create({
  name: 'latex',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      expression: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-expression') || el.textContent || '',
        renderHTML: (attrs) => ({ 'data-expression': attrs.expression }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-latex]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const expr = HTMLAttributes['data-expression'] || '';
    let html = '';
    try {
      html = katex.renderToString(expr, {
        throwOnError: false,
        displayMode: true,
        trust: true,
      });
    } catch {
      html = `<span style="color:#8B949E;font-style:italic">${expr || 'LaTeX'}</span>`;
    }

    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-latex': '',
        style: 'text-align: center; padding: 16px 8px; margin: 12px 0; background: rgba(22,27,34,0.5); border-radius: 8px; border: 1px solid rgba(48,54,61,0.4); overflow-x: auto;',
      }),
      html,
    ];
  },

  addCommands() {
    return {
      setLatex:
        (expression = '') =>
        ({ commands }) => {
          if (expression) {
            return commands.insertContent({
              type: 'latex',
              attrs: { expression },
            });
          }
          const input = window.prompt('Enter LaTeX expression:');
          if (input) {
            return commands.insertContent({
              type: 'latex',
              attrs: { expression: input },
            });
          }
          return false;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-l': () => this.editor.commands.setLatex(),
    };
  },
});