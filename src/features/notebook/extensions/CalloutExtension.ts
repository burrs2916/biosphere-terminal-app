import { Node, mergeAttributes } from '@tiptap/core';

export type CalloutType = 'info' | 'warning' | 'success' | 'danger' | 'tip';

const CALLOUT_ICONS: Record<CalloutType, string> = {
  info: '💡',
  warning: '⚠️',
  success: '✅',
  danger: '🚫',
  tip: '💭',
};

const CALLOUT_COLORS: Record<CalloutType, { bg: string; border: string; icon: string }> = {
  info: { bg: 'rgba(79, 195, 247, 0.08)', border: '#4FC3F7', icon: '#4FC3F7' },
  warning: { bg: 'rgba(255, 215, 64, 0.08)', border: '#FFD740', icon: '#FFD740' },
  success: { bg: 'rgba(0, 230, 118, 0.08)', border: '#00E676', icon: '#00E676' },
  danger: { bg: 'rgba(255, 123, 114, 0.08)', border: '#FF7B72', icon: '#FF7B72' },
  tip: { bg: 'rgba(108, 99, 255, 0.08)', border: '#6C63FF', icon: '#6C63FF' },
};

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (type?: CalloutType) => ReturnType;
      toggleCallout: (type?: CalloutType) => ReturnType;
      unsetCallout: () => ReturnType;
    };
  }
}

export const CalloutExtension = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      type: {
        default: 'info',
        parseHTML: (el) => el.getAttribute('data-callout-type') || 'info',
        renderHTML: (attrs) => ({ 'data-callout-type': attrs.type }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const type = (HTMLAttributes['data-callout-type'] || 'info') as CalloutType;
    const colors = CALLOUT_COLORS[type];
    const icon = CALLOUT_ICONS[type];

    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-callout': '',
        style: `border-left: 3px solid ${colors.border}; background: ${colors.bg}; border-radius: 0 8px 8px 0; padding: 12px 16px; margin: 12px 0; display: flex; gap: 10px; align-items: flex-start;`,
      }),
      ['span', { style: `font-size: 1.1em; flex-shrink: 0; margin-top: 1px;`, 'data-callout-icon': '' }, icon],
      ['div', { style: 'flex: 1; min-width: 0;', 'data-callout-content': '' }, 0],
    ];
  },

  addCommands() {
    return {
      setCallout:
        (type: CalloutType = 'info') =>
        ({ commands }) => {
          return commands.wrapIn({ name: 'callout', type } as never);
        },
      toggleCallout:
        (type: CalloutType = 'info') =>
        ({ editor, commands }) => {
          if (editor.isActive('callout')) {
            return commands.lift('callout');
          }
          return commands.wrapIn({ name: 'callout', type } as never);
        },
      unsetCallout:
        () =>
        ({ commands }) => {
          return commands.lift('callout');
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-c': () => this.editor.commands.toggleCallout('info'),
    };
  },
});