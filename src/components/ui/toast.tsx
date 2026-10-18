import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { errorKey } from '@/lib/errors';
import { cx } from './ui';

interface Toast { id: number; tone: 'success' | 'error' | 'info'; text: string }
interface ToastApi {
  success: (text: string) => void;
  info: (text: string) => void;
  error: (err: unknown) => void;
}
const ToastContext = createContext<ToastApi | null>(null);
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast['tone'], text: string) => {
    const id = ++seq;
    setToasts((all) => [...all.slice(-3), { id, tone, text }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 3500);
  }, []);
  const api = useMemo<ToastApi>(() => ({
    success: (text) => push('success', text),
    info: (text) => push('info', text),
    error: (err) => {
      const info = errorKey(err);
      push('error', t(info.key, info.values));
    },
  }), [push, t]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6">
        {toasts.map((x) => (
          <div key={x.id} role={x.tone === 'error' ? 'alert' : 'status'}
            className={cx('pointer-events-auto w-full max-w-md rounded-xl px-4 py-3 text-sm font-medium shadow-lg',
              x.tone === 'success' && 'bg-green-700 text-white', x.tone === 'error' && 'bg-red-700 text-white', x.tone === 'info' && 'bg-slate-800 text-white')}>
            {x.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast outside ToastProvider');
  return ctx;
}
