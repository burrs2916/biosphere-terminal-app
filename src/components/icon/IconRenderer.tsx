import { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import * as iconService from '../../core/services/icon.service';
import { useNotify } from '../../core/notification';
import { isCustomIconValue, isMaterialIconValue, getMaterialIconName } from './iconUtils';
import { localizeBackendError } from '../../core/backendError';

interface IconRendererProps {
  value: string;
  size?: number;
  iconUrls?: Record<string, string>;
  sx?: object;
}

let cachedIconUrls: Record<string, string> | null = null;
let fetchPromise: Promise<Record<string, string>> | null = null;
const singleFetchInFlight = new Map<string, Promise<string | null>>();

async function getIconUrls(): Promise<Record<string, string>> {
  if (cachedIconUrls) return cachedIconUrls;
  if (fetchPromise) return fetchPromise;
  fetchPromise = iconService.getCustomIconUrls().finally(() => {
    fetchPromise = null;
  });
  cachedIconUrls = await fetchPromise;
  return cachedIconUrls;
}

async function getIconUrlById(id: string): Promise<string | null> {
  // Deduplicate concurrent requests for the same icon id.
  const existing = singleFetchInFlight.get(id);
  if (existing) return existing;
  const p = iconService.getCustomIconUrl(id).finally(() => {
    singleFetchInFlight.delete(id);
  });
  singleFetchInFlight.set(id, p);
  const url = await p;
  if (url && cachedIconUrls) {
    cachedIconUrls[id] = url;
  }
  return url;
}

export function invalidateIconUrlCache() {
  cachedIconUrls = null;
}

export function IconRenderer({ value, size = 20, iconUrls: externalUrls, sx = {} }: IconRendererProps) {
  const [resolvedUrls, setResolvedUrls] = useState<Record<string, string>>(externalUrls || {});
  const notify = useNotify().notify;

  useEffect(() => {
    if (externalUrls) {
      setResolvedUrls(externalUrls);
      cachedIconUrls = externalUrls;
      return;
    }
    if (isCustomIconValue(value)) {
      const id = value.replace('custom:', '');
      getIconUrls()
        .then(async (urls) => {
          if (urls[id]) {
            setResolvedUrls(urls);
            return;
          }
          // Icon missing from batch (likely oversized) — lazy fetch single icon.
          const url = await getIconUrlById(id);
          if (url) {
            setResolvedUrls({ ...urls, [id]: url });
          } else {
            setResolvedUrls(urls);
          }
        })
        .catch((e) => notify(localizeBackendError(e)));
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
