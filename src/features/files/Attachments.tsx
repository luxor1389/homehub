import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { unwrap, useAction, useHHQuery } from '@/lib/hooks';
import { useCurrentHousehold } from '@/household/HouseholdProvider';
import { Button, Card, ConfirmDialog, LoadingState } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { useToast } from '@/components/ui/toast';
import { formatDateTime } from '@/lib/dates';
import type { Attachment } from '@/lib/types';

export const BUCKET = 'household-files';
export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];
export const MAX_BYTES = 10 * 1024 * 1024;

export function safeFileName(name: string) {
  return name.normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-80) || 'file';
}

/** Uploads into the private bucket under `<household>/<entity>/…`. Returns the storage path. */
export async function uploadFile(householdId: string, folder: string, file: File): Promise<string> {
  if (!ALLOWED_TYPES.includes(file.type)) throw { message: 'file_type' };
  if (file.size > MAX_BYTES) throw { message: 'file_size' };
  const path = `${householdId}/${folder}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return path;
}

export async function openSignedUrl(path: string) {
  // Signed URLs are short-lived; the bucket itself is private.
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 120);
  if (error) throw error;
  window.open(data.signedUrl, '_blank', 'noopener');
}

export function Attachments({ entityType, entityId, title }: { entityType: string; entityId: string; title?: string }) {
  const { t, i18n } = useTranslation();
  const { householdId, memberName, household } = useCurrentHousehold();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [toDelete, setToDelete] = useState<Attachment | null>(null);
  const list = useHHQuery('attachments', [entityType, entityId], async () =>
    unwrap(await supabase.from('attachments').select('*').eq('entity_type', entityType).eq('entity_id', entityId).order('created_at', { ascending: false })) as Attachment[]);

  const upload = useAction(async (file: File) => {
    const path = await uploadFile(householdId, entityType, file);
    const res = await supabase.from('attachments').insert({
      household_id: householdId, entity_type: entityType, entity_id: entityId, storage_path: path,
      file_name: file.name.slice(0, 200), mime_type: file.type, size_bytes: file.size,
    });
    if (res.error) {
      await supabase.storage.from(BUCKET).remove([path]); // do not leave orphaned files behind
      throw res.error;
    }
  }, { groups: ['attachments'], success: 'files.uploaded' });

  const remove = useAction(async (a: Attachment) => {
    unwrap(await supabase.from('attachments').delete().eq('id', a.id).select('id').single());
    const { error } = await supabase.storage.from(BUCKET).remove([a.storage_path]);
    if (error) throw error;
  }, { groups: ['attachments'], success: 'files.deleted', onSuccess: () => setToDelete(null) });

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) return toast.info(t('files.typeNotAllowed'));
    if (file.size > MAX_BYTES) return toast.info(t('files.tooLarge'));
    upload.mutate(file);
  };

  return (
    <Card title={title ?? t('files.title')} action={
      <>
        <input ref={input} type="file" accept={ALLOWED_TYPES.join(',')} className="hidden" onChange={onPick} aria-label={t('files.add')} />
        <Button size="sm" variant="secondary" icon="paperclip" loading={upload.isPending} onClick={() => input.current?.click()}>{t('files.add')}</Button>
      </>
    }>
      {list.isLoading ? <LoadingState /> : list.data?.length ? (
        <ul className="divide-y divide-slate-100">
          {list.data.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <button type="button" className="min-w-0 text-left hover:underline" onClick={() => openSignedUrl(a.storage_path).catch((e) => toast.error(e))}>
                <Icon name={a.mime_type === 'application/pdf' ? 'paperclip' : 'link'} className="mr-1 inline h-4 w-4" />
                <span className="break-all">{a.file_name}</span>
                <span className="block text-xs text-slate-500">{memberName(a.created_by)} · {formatDateTime(a.created_at, i18n.language, household.timezone)} · {(a.size_bytes / 1024).toFixed(0)} KB</span>
              </button>
              <button type="button" aria-label={t('common.delete')} className="h-10 w-10 shrink-0 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-red-600" onClick={() => setToDelete(a)}>
                <Icon name="trash" className="mx-auto h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-slate-500">{t('files.empty')}</p>}
      <p className="mt-2 text-xs text-slate-500">{t('files.hint')}</p>
      <ConfirmDialog open={Boolean(toDelete)} title={t('files.deleteTitle')} message={t('files.deleteConfirm', { name: toDelete?.file_name })}
        loading={remove.isPending} onCancel={() => setToDelete(null)} onConfirm={() => toDelete && remove.mutate(toDelete)} />
    </Card>
  );
}

/** Signed image preview for a private photo path. */
export function useSignedUrl(path: string | null | undefined) {
  return useHHQuery('attachments', ['signed', path], async () => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path!, 3600);
    if (error) throw error;
    return data.signedUrl;
  }, Boolean(path));
}
