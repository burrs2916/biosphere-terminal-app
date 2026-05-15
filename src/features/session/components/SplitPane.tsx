import Box from '@mui/material/Box';
import type { ReactNode } from 'react';

interface SplitPaneProps {
  direction: 'horizontal' | 'vertical';
  children: ReactNode[];
  sizes?: number[];
}

export function SplitPane({ direction, children, sizes }: SplitPaneProps) {
  const isHorizontal = direction === 'horizontal';

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: isHorizontal ? 'row' : 'column',
        height: '100%',
        width: '100%',
        overflow: 'hidden',
      }}
    >
      {children.map((child, index) => (
        <Box
          key={index}
          sx={{
            flex: sizes?.[index] ?? 1,
            overflow: 'hidden',
            minWidth: 0,
            minHeight: 0,
          }}
        >
          {child}
        </Box>
      ))}
    </Box>
  );
}
