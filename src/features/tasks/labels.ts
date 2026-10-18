import type { TFunction } from 'i18next';
import type { Freq, Occurrence, Room } from '@/lib/types';
import { SUBCATEGORY_KEYS } from './presets';
import { weekdayName } from '@/lib/dates';
import type { Tone } from '@/components/ui/ui';

export function roomLabel(room: Pick<Room, 'kind' | 'name'> | undefined | null, t: TFunction): string {
  if (!room) return '';
  return room.name ?? t(`rooms.${room.kind}`);
}
export function subcategoryLabel(sub: string | null, t: TFunction): string {
  if (!sub) return '';
  return SUBCATEGORY_KEYS.has(sub) ? t(`cleaning.presets.${sub}`) : sub;
}
export function recurrenceLabel(o: { recurrence_freq: Freq; recurrence_interval: number; recurrence_weekdays?: number[] | null }, t: TFunction, locale: string): string {
  if (o.recurrence_freq === 'none') return t('recurrence.none');
  const n = o.recurrence_interval || 1;
  let s = t(`recurrence.every.${o.recurrence_freq}`, { count: n });
  if (o.recurrence_freq === 'weekly' && o.recurrence_weekdays?.length) {
    s += ` (${o.recurrence_weekdays.map((d) => weekdayName(d, locale)).join(', ')})`;
  }
  return s;
}
export function statusTone(o: Pick<Occurrence, 'status' | 'is_overdue'>): Tone {
  if (o.is_overdue) return 'red';
  return ({ planned: 'blue', in_progress: 'amber', done: 'green', cancelled: 'gray' } as const)[o.status];
}
export function statusLabel(o: Pick<Occurrence, 'status' | 'is_overdue'>, t: TFunction): string {
  return o.is_overdue ? t('status.overdue') : t(`status.${o.status}`);
}
export const priorityTone = { low: 'gray', normal: 'blue', high: 'amber', urgent: 'red' } as const;
