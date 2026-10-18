import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { unwrap, useAction, type Group } from '@/lib/hooks';
import { useCurrentHousehold } from '@/household/HouseholdProvider';
import { Spinner } from '@/components/ui/ui';
import { Icon, type IconName } from '@/components/ui/icons';
import { BUCKET, uploadFile, useSignedUrl } from './Attachments';

/** Profile photo of a vehicle / pet / plant stored in the private bucket. */
export function Photo({ table, id, path, group, fallback, editable = true }: {
  table: 'vehicles' | 'pets' | 'plants'; id: string; path: string | null; group: Group; fallback: IconName; editable?: boolean;
}) {
  const { t } = useTranslation();
  const { householdId } = useCurrentHousehold();
  const input = useRef<HTMLInputElement>(null);
  const url = useSignedUrl(path);
  const upload = useAction(async (file: File) => {
    if (!file.type.startsWith('image/')) throw { message: 'file_type' };
    const newPath = await uploadFile(householdId, `${table}/${id}`, file);
    const res = await supabase.from(table).update({ photo_path: newPath }).eq('id', id).select('id').single();
    if (res.error) {
      await supabase.storage.from(BUCKET).remove([newPath]);
      throw res.error;
    }
    if (path) await supabase.storage.from(BUCKET).remove([path]);
    return unwrap(res);
  }, { groups: [group, 'attachments'], success: 'files.photoSaved' });
  return (
    <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-2xl bg-slate-100">
      {url.data ? <img src={url.data} alt="" className="h-full w-full object-cover" /> : <Icon name={fallback} className="m-auto mt-7 h-10 w-10 text-slate-400" />}
      {editable && (
        <>
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/heic" className="hidden" aria-label={t('files.changePhoto')}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload.mutate(f); }} />
          <button type="button" onClick={() => input.current?.click()} aria-label={t('files.changePhoto')}
            className="absolute inset-x-0 bottom-0 flex h-8 items-center justify-center bg-slate-900/50 text-white">
            {upload.isPending ? <Spinner className="h-4 w-4" /> : <Icon name="edit" className="h-4 w-4" />}
          </button>
        </>
      )}
      {url.error ? <span className="sr-only">{t('files.previewError')}</span> : null}
    </div>
  );
}
