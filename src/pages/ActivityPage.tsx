import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, PageHeader } from '@/components/ui/ui';
import { ActivityList } from '@/features/activity/ActivityList';

export default function ActivityPage() {
  const { t } = useTranslation();
  const [limit, setLimit] = useState(50);
  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.activity')} subtitle={t('activity.subtitle')} />
      <Card>
        <ActivityList limit={limit} />
        <div className="mt-4 text-center"><Button variant="secondary" onClick={() => setLimit((l) => l + 50)}>{t('common.loadMore')}</Button></div>
      </Card>
    </div>
  );
}
