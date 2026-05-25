import { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import * as iconService from '../../core/services/icon.service';
import { isCustomIconValue, isMaterialIconValue, getMaterialIconName } from './iconUtils';

interface IconRendererProps {
  value: string;
  size?: number;
  iconUrls?: Record<string, string>;
  sx?: object;
}

let cachedIconUrls: Record<string, string> | null = null;
let fetchPromise: Promise<Record<string, string>> | null = null;

async function getIconUrls(): Promise<Record<string, string>> {
  if (cachedIconUrls) return cachedIconUrls;
  if (fetchPromise) return fetchPromise;
  fetchPromise = iconService.getCustomIconUrls().finally(() => {
    fetchPromise = null;
  });
  cachedIconUrls = await fetchPromise;
  return cachedIconUrls;
}

export function invalidateIconUrlCache() {
  cachedIconUrls = null;
}

export function IconRenderer({ value, size = 20, iconUrls: externalUrls, sx = {} }: IconRendererProps) {
  const [resolvedUrls, setResolvedUrls] = useState<Record<string, string>>(externalUrls || {});

  useEffect(() => {
    if (externalUrls) {
      setResolvedUrls(externalUrls);
      cachedIconUrls = externalUrls;
      return;
    }
    if (isCustomIconValue(value)) {
      getIconUrls().then(setResolvedUrls).catch(() => {});
    }
  }, [value, externalUrls]);

  if (isCustomIconValue(value)) {
    const id = value.replace('custom:', '');
    const url = resolvedUrls[id];
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          ...sx,
        }}
      >
        {url ? (
          <img src={url} alt="" style={{ width: size, height: size, objectFit: 'contain' }} />
        ) : (
          <span style={{ fontSize: size }}>📁</span>
        )}
      </Box>
    );
  }

  if (isMaterialIconValue(value)) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          ...sx,
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: size }}>
          {getMaterialIconName(value)}
        </span>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size,
        ...sx,
      }}
    >
      {value || '📁'}
    </Box>
  );
}
