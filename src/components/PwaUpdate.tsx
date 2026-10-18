import { useTranslation } from 'react-i18next';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '@/components/ui/ui';

/** Registers the service worker and offers a reload when a new app version is ready. */
export function PwaUpdate() {
  const { t } = useTranslation();
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div role="status" className="fixed inset-x-4 bottom-20 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-slate-900 p-3 text-sm text-white shadow-lg md:bottom-4">
      <span className="flex-1">{t('pwa.updateReady')}</span>
      <Button size="sm" variant="ghost" className="text-white hover:bg-slate-700" onClick={() => setNeedRefresh(false)}>{t('common.close')}</Button>
      <Button size="sm" onClick={() => void updateServiceWorker(true)}>{t('pwa.reload')}</Button>
    </div>
  );
}
