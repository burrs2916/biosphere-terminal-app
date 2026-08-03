import type { Editor } from '@tiptap/react';

/**
 * 粘贴内容清理工具
 *
 * 用户常把 iTerm2 终端输出粘贴到笔记，这些输出自带装饰元数据，
 * 原样进笔记会非常难看：
 *
 *   (base) liwenchao@liwenchaodeMac-mini ~ % ls
 *
 *   ++==📁 /Users/liwenchao++==
 *   🕐 2026/8/3 09:35:29
 *
 * 清理目标（保守，只动噪声，不动用户实际写的正文）：
 *   1. iTerm2 拖拽文件夹注释行：`++==📁 ...==++` （可能带 ANSI 转义）
 *   2. iTerm2 文件元数据行：`🕐 yyyy/m/d hh:mm:ss`（也兼容 emoji 变种）
 *   3. 紧跟其后的纯空白行
 *   4. 3 个以上连续空行压缩为 2 个
 *
 * 不清理：
 *   - 普通 shell prompt（用户可能想留作命令记录）
 *   - 命令输出本身
 *   - 用户已经写好的笔记正文（这些规则只在粘贴时跑一次，不跑历史数据）
 */

export interface PasteCleanResult {
  /** 清理后的文本；如果和原文一致则 length 不变 */
  text: string;
  /** 删了多少行（iTerm2 装饰 + 多空行） */
  removedLines: number;
}

/**
 * 检测一行是否是 iTerm2 拖拽文件夹装饰注释
 * 例：`++==📁 /Users/liwenchao==++`、`\x1b[1m++==📁 /tmp==++\x1b[0m`
 */
const isItermDragAnnotation = (line: string): boolean => {
  // 去掉 ANSI 转义后匹配
  const stripped = line.replace(/\x1b\[[0-9;]*m/g, '');
  return /\+\+==.*==\+\+/.test(stripped);
};

/**
 * 检测一行是否是 iTerm2 文件元数据时间戳
 * 例：`🕐 2026/8/3 09:35:29`、`🕓 2026-08-03 09:35:29`（emoji 可能因系统不同）
 */
const isItermFileMeta = (line: string): boolean => {
  const stripped = line.replace(/\x1b\[[0-9;]*m/g, '').trim();
  // 任意 emoji + 至少含一个 4 位年份
  return /^(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]|🕐|🕑|🕒|🕓|🕔|🕕|🕖|🕗|🕘|🕙|🕚|🕛)/u.test(stripped)
    && /\d{4}/.test(stripped);
};

export function sanitizePastedText(raw: string): PasteCleanResult {
  if (!raw) return { text: raw, removedLines: 0 };

  const originalLines = raw.split('\n');
  const kept: string[] = [];
  let removed = 0;

  for (let i = 0; i < originalLines.length; i++) {
    const line = originalLines[i];
    if (isItermDragAnnotation(line)) {
      // 拖拽装饰行 + 紧跟的元数据行一起删（典型模式：装饰行 + 🕐 时间戳）
      removed++;
      // 看下一行是不是文件元数据
      if (i + 1 < originalLines.length && isItermFileMeta(originalLines[i + 1])) {
        removed++;
        i++;
      }
      // 紧跟的纯空行也吃掉一个（装饰块后面通常留一行空）
      if (i + 1 < originalLines.length && originalLines[i + 1].trim() === '') {
        removed++;
        i++;
      }
      continue;
    }
    if (isItermFileMeta(line)) {
      // 单独的元数据行（没有配装饰）
      removed++;
      if (i + 1 < originalLines.length && originalLines[i + 1].trim() === '') {
        removed++;
        i++;
      }
      continue;
    }
    kept.push(line);
  }

  // 多空行压缩：3+ 个连续 \n → 2 个（即最多保留一行空行作为段落分隔）
  const compressed = kept.join('\n').replace(/\n{3,}/g, '\n\n');

  // 去掉首尾空行（避免粘贴后顶部出现无意义空白）
  const trimmed = compressed.replace(/^\n+|\n+$/g, '');

  return { text: trimmed, removedLines: removed };
}

/**
 * 把清理结果应用到 Tiptap 编辑器当前选区。
 * 如果没有可清理的（removedLines === 0 且文本未变），返回 false 让 Tiptap 默认 paste 行为接管。
 */
export function applySanitizedPaste(editor: Editor, result: PasteCleanResult): boolean {
  if (!result.removedLines || result.text === editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n', '\n')) {
    // 文本未变化 → 让 Tiptap 默认行为处理
    return false;
  }
  // 在当前选区位置插入清理后文本（保留光标相对位置）
  const { from, to } = editor.state.selection;
  editor.chain()
    .focus()
    .insertContentAt({ from, to }, result.text)
    .run();
  return true;
}