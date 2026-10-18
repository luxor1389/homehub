import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useHousehold } from '@/household/HouseholdProvider';
import { Button, Card, Field, Input, LoadingState, Select, Textarea } from '@/components/ui/ui';
import { useToast } from '@/components/ui/toast';
import { CURRENCIES, timeZones } from '@/lib/options';
import { LanguageSwitch } from './AuthPages';

export const householdSchema = z.object({
  name: z.string().trim().min(1, 'validation.required').max(100, 'validation.tooLong'),
  address: z.string().trim().max(200, 'validation.tooLong').optional(),
  description: z.string().trim().max(500, 'validation.tooLong').optional(),
  timezone: z.string().min(1, 'validation.required'),
  currency: z.string().regex(/^[A-Z]{3}$/, 'validation.currency'),
});
export type HouseholdForm = z.infer<typeof householdSchema>;

export function extractInviteToken(input: string): string | null {
  const s = input.trim();
  const m = s.match(/\/join\/([A-Za-z0-9]+)/);
  if (m) return m[1];
  return /^[A-Za-z0-9]{20,}$/.test(s) ? s : null;
}

export function WelcomePage({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation();
  const { profile, signOut } = useAuth();
  const { household, loading, reload, selectHousehold } = useHousehold();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [invite, setInvite] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const form = useForm<HouseholdForm>({
    resolver: zodResolver(householdSchema),
    defaultValues: { timezone: 'Europe/Belgrade', currency: 'RSD' },
  });
  if (loading) return <LoadingState />;
  if (household && !embedded) return <Navigate to="/" replace />;

  const onSubmit = form.handleSubmit(async (v) => {
    const { data, error } = await supabase.rpc('create_household', {
      p_name: v.name, p_timezone: v.timezone, p_currency: v.currency, p_address: v.address || null, p_description: v.description || null,
    });
    if (error) return toast.error(error);
    selectHousehold(data as string);
    await reload();
    await qc.invalidateQueries();
    toast.success(t('household.created'));
    navigate('/settings?tab=members', { replace: true });
  });
  const e = form.formState.errors;
  return (
    <div className={embedded ? '' : 'min-h-dvh bg-slate-50 px-4 py-8'}>
      <div className="mx-auto max-w-xl space-y-4">
        {!embedded && (
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">{t('welcome.title', { name: profile?.display_name ?? '' })}</h1>
            <LanguageSwitch />
          </div>
        )}
        {!embedded && <p className="text-slate-600">{t('welcome.intro')}</p>}
        <Card title={t('welcome.createTitle')}>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <Field label={t('household.name')} htmlFor="hh-name" error={e.name?.message}>
              <Input id="hh-name" placeholder={t('household.namePlaceholder')} {...form.register('name')} />
            </Field>
            <Field label={t('household.address')} htmlFor="hh-address" error={e.address?.message}>
              <Input id="hh-address" {...form.register('address')} />
            </Field>
            <Field label={t('household.description')} htmlFor="hh-desc" error={e.description?.message}>
              <Textarea id="hh-desc" rows={2} {...form.register('description')} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('household.timezone')} htmlFor="hh-tz" error={e.timezone?.message}>
                <Select id="hh-tz" {...form.register('timezone')}>
                  {timeZones().map((z) => <option key={z} value={z}>{z}</option>)}
                </Select>
              </Field>
              <Field label={t('household.currency')} htmlFor="hh-cur" error={e.currency?.message}>
                <Select id="hh-cur" {...form.register('currency')}>
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </Field>
            </div>
            <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>{t('welcome.create')}</Button>
          </form>
        </Card>
        <Card title={t('welcome.joinTitle')}>
          <p className="mb-3 text-sm text-slate-600">{t('welcome.joinHint')}</p>
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(ev) => {
            ev.preventDefault();
            const token = extractInviteToken(invite);
            if (!token) return setInviteError('welcome.invalidLink');
            navigate(`/join/${token}`);
          }}>
            <Input aria-label={t('welcome.inviteLink')} placeholder={t('welcome.inviteLink')} value={invite} onChange={(ev) => { setInvite(ev.target.value); setInviteError(null); }} />
            <Button type="submit" variant="secondary">{t('welcome.continue')}</Button>
          </form>
          {inviteError && <p role="alert" className="mt-2 text-sm text-red-600">{t(inviteError)}</p>}
        </Card>
        {!embedded && <Button variant="ghost" icon="logout" onClick={() => void signOut()}>{t('auth.logout')}</Button>}
      </div>
    </div>
  );
}
