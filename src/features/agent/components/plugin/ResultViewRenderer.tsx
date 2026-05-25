import React from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Link,
  useTheme,
} from '@mui/material';
import type { ResultViewSpec, TableColumn } from '../../../../proto/plugin';

interface ResultViewRendererProps {
  resultView: ResultViewSpec | undefined;
  output: string;
  success: boolean;
}

export const ResultViewRenderer: React.FC<ResultViewRendererProps> = ({
  resultView,
  output,
  success,
}) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const monoColor = isDark ? '#E0E0E0' : '#333';
  const codeBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)';
  const codeBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const tableHeaderBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)';
  const tableRowHover = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)';
  const inlineCodeBg = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)';
  const listItemBg = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)';
  const listItemBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

  if (!success) {
    return (
      <Box
        sx={{
          fontFamily: 'monospace',
          fontSize: '0.8rem',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          color: isDark ? '#FF8A80' : '#d32f2f',
          bgcolor: isDark ? 'rgba(244,67,54,0.08)' : 'rgba(244,67,54,0.04)',
          p: 1.5,
          borderRadius: 1,
          border: `1px solid ${isDark ? 'rgba(244,67,54,0.2)' : 'rgba(244,67,54,0.15)'}`,
        }}
      >
        {output}
      </Box>
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    parsed = null;
  }

  if (resultView && resultView.viewType !== 'text') {
    return renderByViewType(resultView, output, parsed, isDark, monoColor, codeBg, codeBorder, tableHeaderBg, tableRowHover, inlineCodeBg, listItemBg, listItemBorder);
  }

  if (parsed !== null) {
    return renderAutoDetected(parsed, output, isDark, monoColor, codeBg, codeBorder, tableHeaderBg, tableRowHover, inlineCodeBg, listItemBg, listItemBorder);
  }

  return (
    <Box
      sx={{
        fontFamily: 'monospace',
        fontSize: '0.8rem',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        color: monoColor,
      }}
    >
      {output}
    </Box>
  );
};

function renderByViewType(
  spec: ResultViewSpec,
  rawOutput: string,
  parsed: unknown,
  isDark: boolean,
  monoColor: string,
  codeBg: string,
  codeBorder: string,
  tableHeaderBg: string,
  tableRowHover: string,
  _inlineCodeBg: string,
  listItemBg: string,
  listItemBorder: string,
) {
  switch (spec.viewType) {
    case 'table':
      return renderTableView(spec.columns || [], parsed, rawOutput, isDark, monoColor, tableHeaderBg, tableRowHover);
    case 'list':
      return renderListView(parsed, rawOutput, isDark, monoColor, listItemBg, listItemBorder);
    case 'json':
      return renderJsonView(parsed, rawOutput, isDark, monoColor, codeBg, codeBorder);
    case 'markdown':
      return renderMarkdownView(rawOutput, isDark, _inlineCodeBg);
    case 'text':
    default:
      return (
        <Box sx={{ fontFamily: 'monospace', fontSize: '0.8rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: monoColor }}>
          {rawOutput}
        </Box>
      );
  }
}

function renderTableView(
  columns: TableColumn[],
  parsed: unknown,
  rawOutput: string,
  isDark: boolean,
  monoColor: string,
  tableHeaderBg: string,
  tableRowHover: string,
) {
  let rows: Record<string, unknown>[] = [];

  if (Array.isArray(parsed)) {
    rows = parsed.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
  } else if (typeof parsed === 'object' && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.data)) {
      rows = obj.data.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
    } else if (Array.isArray(obj.results)) {
      rows = obj.results.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
    } else if (Array.isArray(obj.items)) {
      rows = obj.items.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
    } else if (Array.isArray(obj.rows)) {
      rows = obj.rows.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
    }
  }

  if (rows.length === 0) {
    return (
      <Box sx={{ fontFamily: 'monospace', fontSize: '0.8rem', whiteSpace: 'pre-wrap', color: monoColor }}>
        {rawOutput}
      </Box>
    );
  }

  const effectiveColumns = columns.length > 0
    ? columns
    : Object.keys(rows[0]).map((key) => ({ key, label: key }));

  return (
    <TableContainer
      component={Paper}
      variant="outlined"
      sx={{
        maxHeight: 400,
        bgcolor: isDark ? 'rgba(255,255,255,0.02)' : 'transparent',
        borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
      }}
    >
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            {effectiveColumns.map((col) => (
              <TableCell
                key={col.key}
                sx={{
                  fontWeight: 700,
                  fontSize: '0.75rem',
                  bgcolor: tableHeaderBg,
                  color: isDark ? '#B0BEC5' : '#455A64',
                  borderBottomColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                }}
              >
                {col.label}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.slice(0, 100).map((row, idx) => (
            <TableRow
              key={idx}
              hover
              sx={{
                '&:hover': { bgcolor: tableRowHover },
                '& td': {
                  borderBottomColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
                  color: isDark ? '#CFD8DC' : '#37474F',
                },
              }}
            >
              {effectiveColumns.map((col) => (
                <TableCell key={col.key} sx={{ fontSize: '0.75rem' }}>
                  {renderCellValue(row[col.key], isDark)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function renderCellValue(value: unknown, isDark: boolean): React.ReactNode {
  if (value === null || value === undefined) {
    return <Typography variant="caption" color="text.disabled">-</Typography>;
  }
  if (typeof value === 'boolean') {
    return <Chip label={value ? 'Yes' : 'No'} size="small" color={value ? 'success' : 'default'} />;
  }
  if (typeof value === 'number') {
    return <span style={{ color: isDark ? '#80CBC4' : '#00695C' }}>{value.toLocaleString()}</span>;
  }
  if (typeof value === 'string') {
    if (value.startsWith('http://') || value.startsWith('https://')) {
      return <Link href={value} target="_blank" rel="noopener" sx={{ fontSize: '0.75rem', color: isDark ? '#4FC3F7' : '#1976d2' }}>{value}</Link>;
    }
    if (value.length > 200) {
      return value.substring(0, 200) + '...';
    }
    return value;
  }
  if (typeof value === 'object') {
    return <span style={{ fontFamily: 'monospace', fontSize: '0.7rem', color: isDark ? '#90A4AE' : '#607D8B' }}>{JSON.stringify(value)}</span>;
  }
  return String(value);
}

function renderListView(
  parsed: unknown,
  rawOutput: string,
  isDark: boolean,
  monoColor: string,
  listItemBg: string,
  listItemBorder: string,
) {
  let items: unknown[] = [];

  if (Array.isArray(parsed)) {
    items = parsed;
  } else if (typeof parsed === 'object' && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    const arrKey = ['items', 'data', 'results', 'list', 'entries'].find((k) => Array.isArray(obj[k]));
    if (arrKey) {
      items = obj[arrKey] as unknown[];
    }
  }

  if (items.length === 0) {
    return (
      <Box sx={{ fontFamily: 'monospace', fontSize: '0.8rem', whiteSpace: 'pre-wrap', color: monoColor }}>
        {rawOutput}
      </Box>
    );
  }

  return (
    <Box>
      {items.slice(0, 50).map((item, idx) => (
        <Paper
          key={idx}
          variant="outlined"
          sx={{
            p: 1.5,
            mb: 0.5,
            bgcolor: listItemBg,
            borderColor: listItemBorder,
            borderRadius: 1,
          }}
        >
          {typeof item === 'object' && item !== null ? (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {Object.entries(item as Record<string, unknown>).slice(0, 6).map(([k, v]) => (
                <Box key={k} sx={{ mr: 1 }}>
                  <Typography variant="caption" sx={{ color: isDark ? '#90A4AE' : '#78909C', fontSize: 11 }}>{k}: </Typography>
                  <Typography variant="caption" sx={{ fontWeight: 500, color: isDark ? '#E0E0E0' : '#37474F', fontSize: 11 }}>
                    {typeof v === 'string' ? (v.length > 60 ? v.substring(0, 60) + '...' : v) : String(v)}
                  </Typography>
                </Box>
              ))}
            </Box>
          ) : (
            <Typography variant="body2" sx={{ color: isDark ? '#E0E0E0' : '#333' }}>{String(item)}</Typography>
          )}
        </Paper>
      ))}
      {items.length > 50 && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
          显示前 50 条，共 {items.length} 条
        </Typography>
      )}
    </Box>
  );
}

function renderJsonView(
  parsed: unknown,
  rawOutput: string,
  _isDark: boolean,
  monoColor: string,
  codeBg: string,
  codeBorder: string,
) {
  if (parsed === null) {
    return (
      <Box sx={{ fontFamily: 'monospace', fontSize: '0.8rem', whiteSpace: 'pre-wrap', color: monoColor }}>
        {rawOutput}
      </Box>
    );
  }

  return (
    <Box
      sx={{
        fontFamily: 'monospace',
        fontSize: '0.8rem',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        bgcolor: codeBg,
        border: `1px solid ${codeBorder}`,
        p: 1.5,
        borderRadius: 1,
        maxHeight: 400,
        overflow: 'auto',
        color: monoColor,
      }}
    >
      {JSON.stringify(parsed, null, 2)}
    </Box>
  );
}

function renderMarkdownView(rawOutput: string, isDark: boolean, inlineCodeBg: string) {
  const lines = rawOutput.split('\n');
  const headingColor = isDark ? '#E0E0E0' : '#1a1a1a';
  const bodyColor = isDark ? '#B0BEC5' : '#424242';

  return (
    <Box sx={{ fontSize: '0.85rem', lineHeight: 1.7, color: bodyColor }}>
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('# ')) {
          return <Typography key={idx} variant="h6" sx={{ mt: 1, color: headingColor, fontWeight: 700 }}>{trimmed.slice(2)}</Typography>;
        }
        if (trimmed.startsWith('## ')) {
          return <Typography key={idx} variant="subtitle1" sx={{ mt: 1, fontWeight: 600, color: headingColor }}>{trimmed.slice(3)}</Typography>;
        }
        if (trimmed.startsWith('### ')) {
          return <Typography key={idx} variant="subtitle2" sx={{ mt: 0.5, fontWeight: 600, color: headingColor }}>{trimmed.slice(4)}</Typography>;
        }
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          return (
            <Box key={idx} sx={{ pl: 2, display: 'flex', gap: 0.5, color: bodyColor }}>
              <span>•</span>
              <span>{renderInlineFormatting(trimmed.slice(2), isDark, inlineCodeBg)}</span>
            </Box>
          );
        }
        if (trimmed.startsWith('```')) {
          return null;
        }
        if (trimmed === '') {
          return <Box key={idx} sx={{ height: 8 }} />;
        }
        return <Typography key={idx} variant="body2" sx={{ color: bodyColor }}>{renderInlineFormatting(trimmed, isDark, inlineCodeBg)}</Typography>;
      })}
    </Box>
  );
}

function renderInlineFormatting(text: string, isDark: boolean, inlineCodeBg: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const boldStart = remaining.indexOf('**');
    const codeStart = remaining.indexOf('`');

    let firstMatch = -1;
    let matchType = '';

    if (boldStart >= 0 && (firstMatch < 0 || boldStart < firstMatch)) {
      firstMatch = boldStart;
      matchType = 'bold';
    }
    if (codeStart >= 0 && (firstMatch < 0 || codeStart < firstMatch)) {
      firstMatch = codeStart;
      matchType = 'code';
    }

    if (firstMatch < 0) {
      parts.push(remaining);
      break;
    }

    if (firstMatch > 0) {
      parts.push(remaining.substring(0, firstMatch));
    }

    if (matchType === 'bold') {
      const end = remaining.indexOf('**', firstMatch + 2);
      if (end >= 0) {
        parts.push(
          <strong key={key++} style={{ color: isDark ? '#E0E0E0' : '#1a1a1a' }}>{remaining.substring(firstMatch + 2, end)}</strong>
        );
        remaining = remaining.substring(end + 2);
      } else {
        parts.push(remaining.substring(firstMatch));
        break;
      }
    } else if (matchType === 'code') {
      const end = remaining.indexOf('`', firstMatch + 1);
      if (end >= 0) {
        parts.push(
          <Box
            key={key++}
            component="span"
            sx={{
              fontFamily: 'monospace',
              fontSize: '0.8em',
              bgcolor: inlineCodeBg,
              px: 0.5,
              borderRadius: 0.5,
              color: isDark ? '#80CBC4' : '#00695C',
            }}
          >
            {remaining.substring(firstMatch + 1, end)}
          </Box>
        );
        remaining = remaining.substring(end + 1);
      } else {
        parts.push(remaining.substring(firstMatch));
        break;
      }
    }
  }

  return <>{parts}</>;
}

function renderAutoDetected(
  parsed: unknown,
  rawOutput: string,
  isDark: boolean,
  monoColor: string,
  codeBg: string,
  codeBorder: string,
  tableHeaderBg: string,
  tableRowHover: string,
  _inlineCodeBg: string,
  listItemBg: string,
  listItemBorder: string,
) {
  if (Array.isArray(parsed)) {
    if (parsed.length > 0 && typeof parsed[0] === 'object' && parsed[0] !== null) {
      return renderTableView([], parsed, rawOutput, isDark, monoColor, tableHeaderBg, tableRowHover);
    }
    return renderListView(parsed, rawOutput, isDark, monoColor, listItemBg, listItemBorder);
  }

  if (typeof parsed === 'object' && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    const arrayKeys = Object.keys(obj).filter((k) => Array.isArray(obj[k]));
    if (arrayKeys.length > 0) {
      const firstArrKey = arrayKeys[0];
      const arr = obj[firstArrKey] as unknown[];
      if (arr.length > 0 && typeof arr[0] === 'object' && arr[0] !== null) {
        return renderTableView([], parsed, rawOutput, isDark, monoColor, tableHeaderBg, tableRowHover);
      }
      return renderListView(parsed, rawOutput, isDark, monoColor, listItemBg, listItemBorder);
    }

    return renderJsonView(parsed, rawOutput, isDark, monoColor, codeBg, codeBorder);
  }

  return (
    <Box sx={{ fontFamily: 'monospace', fontSize: '0.8rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: monoColor }}>
      {rawOutput}
    </Box>
  );
}

export default ResultViewRenderer;
