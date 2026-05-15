import { useEffect, useRef, useCallback } from 'react';

export function useEvent<T>(eventName: string, handler: (payload: T) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<T>(eventName, (event) => {
        handlerRef.current(event.payload);
      }).then((fn) => {
        unlisten = fn;
      });
    });

    return () => {
      unlisten?.();
    };
  }, [eventName]);
}

export function useAsync<T>(fn: () => Promise<T>) {
  const callback = useCallback(fn, []);
  return callback;
}
