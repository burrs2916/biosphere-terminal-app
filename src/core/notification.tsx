import React, { createContext, useContext, useState, useCallback } from 'react';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';

type Severity = 'success' | 'error' | 'warning' | 'info';

interface Notification {
  open: boolean;
  message: string;
  severity: Severity;
}

interface NotificationContextValue {
  notify: (message: string, severity?: Severity) => void;
}

const NotificationContext = createContext<NotificationContextValue>({
  notify: () => {},
});

export function useNotify() {
  return useContext(NotificationContext);
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Notification>({
    open: false,
    message: '',
    severity: 'error',
  });

  const notify = useCallback((message: string, severity: Severity = 'info') => {
    setState({ open: true, message, severity });
  }, []);

  const handleClose = useCallback(() => {
    setState((s) => ({ ...s, open: false }));
  }, []);

  return (
    <NotificationContext.Provider value={{ notify }}>
      {children}
      <Snackbar
        open={state.open}
        autoHideDuration={5000}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={handleClose}
          severity={state.severity}
          variant="filled"
          sx={{ fontSize: 13, minWidth: 280 }}
        >
          {state.message}
        </Alert>
      </Snackbar>
    </NotificationContext.Provider>
  );
}
