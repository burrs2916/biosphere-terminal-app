// Lightweight line-level diff (LCS based) — no external dependency.
// Used by the AI remote-update review dialog to show what the AI changed
// relative to the user's local (unsaved) version.

export type DiffType = 'eq' | 'add' | 'del';

export interface DiffLine {
  type: DiffType;
  text: string;
  // 1-based line numbers for the two sides (null when the line does not exist
  // on that side). Makes the unified view easier to read.
  oldNo: number | null;
  newNo: number | null;
}

export interface DiffStats {
  added: number;
  removed: number;
  unchanged: number;
}

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const n = a.length;
  const m = b.length;

  // dp[i][j] = length of LCS of a[i..] and b[j..]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let oldNo = 1;
  let newNo = 1;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push({ type: 'eq', text: a[i], oldNo: oldNo++, newNo: newNo++ });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push({ type: 'del', text: a[i], oldNo: oldNo++, newNo: null });
      i++;
    } else {
      lines.push({ type: 'add', text: b[j], oldNo: null, newNo: newNo++ });
      j++;
    }
  }
  while (i < n) {
    lines.push({ type: 'del', text: a[i], oldNo: oldNo++, newNo: null });
    i++;
  }
  while (j < m) {
    lines.push({ type: 'add', text: b[j], oldNo: null, newNo: newNo++ });
    j++;
  }
  return lines;
}

export function diffStats(lines: DiffLine[]): DiffStats {
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  for (const l of lines) {
    if (l.type === 'add') added++;
    else if (l.type === 'del') removed++;
    else unchanged++;
  }
  return { added, removed, unchanged };
}
