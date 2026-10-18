import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { unwrap, useAction, useHHQuery } from '@/lib/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { useCurrentHousehold } from '@/household/HouseholdProvider';
import { Avatar, Badge, Button, Card, Checkbox, ConfirmDialog, Field, Input, LoadingState, Modal, PageHeader, Select, Tabs, Textarea } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { useToast } from '@/components/ui/toast';
import { CURRENCIES, timeZones } from '@/lib/options';
import { LOCALES } from '@/i18n';
import { formatDate, formatDateTime } from '@/lib/dates';
import type { Invitation, Locale } from '@/lib/types';
import type { MemberInfo } from '@/household/HouseholdProvider';
import { householdSchema, type HouseholdForm, WelcomePage } from './WelcomePage';

type Tab = 'profile' | 'household' | 'members' | 'households';
const TABS: Tab[] = ['profile', 'household', 'members', 'households'];

export default function SettingsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get('tab') as Tab) ? params.get('tab') : 'profile') as Tab;
  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.settings')} />
      <Tabs value={tab} onChange={(v) => setParams({ tab: v }, { replace: true })} items={TABS.map((x) => ({ value: x, label: t(`settings.tabs.${x}`) }))} />
      {tab === 'profile' && <ProfileSettings />}
      {tab === 'household' && <HouseholdSettings />}
      {tab === 'members' && <MembersSettings />}
      {tab === 'households' && <HouseholdsSettings />}
    </div>
  );
}

// ---------------------------------------------------------------- profile
const profileSchema = z.object({
  display_name: z.string().trim().min(1, 'validation.required').max(60, 'validation.tooLong'),
  locale: z.enum(['sr-Latn', 'en']),
  email_notifications: z.boolean(),
});
const passwordSchema = z.object({
  password: z.string().min(8, 'validation.passwordMin').max(72, 'validation.tooLong'),
  confirm: z.string(),
}).refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'validation.passwordMismatch' });

function ProfileSettings() {
  const { t } = useTranslation();
  const { profile, email, updateProfile, signOut } = useAuth();
  const toast = useToast();
  const form = useForm<z.infer<typeof profileSchema>>({ resolver: zodResolver(profileSchema), values: profile ? {
    display_name: profile.display_name, locale: profile.locale, email_notifications: profile.email_notifications,
  } : undefined });
  const pw = useForm<z.infer<typeof passwordSchema>>({ resolver: zodResolver(passwordSchema) });
  const [busy, setBusy] = useState(false);
  if (!profile) return <LoadingState />;
  const save = form.handleSubmit(async (v) => {
    setBusy(true);
    try {
      await updateProfile({ display_name: v.display_name, locale: v.locale as Locale, email_notifications: v.email_notifications });
      toast.success(t('common.saved'));
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  });
  const changePw = pw.handleSubmit(async (v) => {
    const { error } = await supabase.auth.updateUser({ password: v.password });
    if (error) return toast.error(error);
    pw.reset({ password: '', confirm: '' });
    toast.success(t('settings.passwordChanged'));
  });
  const e = form.formState.errors;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={t('settings.profile')}>
        <form className="space-y-4" onSubmit={save} noValidate>
          <p className="text-sm text-slate-600">{t('auth.email')}: <strong>{email}</strong></p>
          <Field label={t('auth.displayName')} htmlFor="s-name" error={e.display_name?.message}><Input id="s-name" autoComplete="name" {...form.register('display_name')} /></Field>
          <Field label={t('settings.language')} htmlFor="s-lang"><Select id="s-lang" {...form.register('locale')}>{LOCALES.map((l) => <option key={l} value={l}>{t(`languages.${l}`)}</option>)}</Select></Field>
          <Checkbox label={t('settings.emailNotifications')} {...form.register('email_notifications')} />
          <p className="text-xs text-slate-500">{t('settings.emailNotificationsHint')}</p>
          <Button type="submit" loading={busy}>{t('common.save')}</Button>
        </form>
      </Card>
      <div className="space-y-4">
        <Card title={t('settings.changePassword')}>
          <form className="space-y-4" onSubmit={changePw} noValidate>
            <Field label={t('auth.newPassword')} htmlFor="s-pw" error={pw.formState.errors.password?.message}><Input id="s-pw" type="password" autoComplete="new-password" {...pw.register('password')} /></Field>
            <Field label={t('auth.confirmPassword')} htmlFor="s-pw2" error={pw.formState.errors.confirm?.message}><Input id="s-pw2" type="password" autoComplete="new-password" {...pw.register('confirm')} /></Field>
            <Button type="submit" variant="secondary" loading={pw.formState.isSubmitting}>{t('settings.changePassword')}</Button>
          </form>
        </Card>
        <Card><Button variant="secondary" icon="logout" onClick={() => void signOut()}>{t('auth.logout')}</Button></Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- household
function HouseholdSettings() {
  const { t } = useTranslation();
  const { household, isAdmin, reload } = useCurrentHousehold();
  const qc = useQueryClient();
  const zones = timeZones();
  const form = useForm<HouseholdForm>({ resolver: zodResolver(householdSchema), values: {
    name: household.name, address: household.address ?? '', description: household.description ?? '', timezone: household.timezone, currency: household.currency,
  } });
  const save = useAction(async (v: HouseholdForm) => unwrap(await supabase.from('households').update({
    name: v.name, address: v.address || null, description: v.description || null, timezone: v.timezone, currency: v.currency,
  }).eq('id', household.id).select('id').single()), { groups: ['members', 'tasks'], success: 'common.saved', onSuccess: () => { void reload(); void qc.invalidateQueries(); } });
  const e = form.formState.errors;
  return (
    <Card title={t('settings.householdData')}>
      {!isAdmin && <p className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900"><Icon name="info" className="mr-1 inline h-4 w-4" />{t('settings.adminOnly')}</p>}
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
        <fieldset disabled={!isAdmin} className="contents">
          <Field label={t('household.name')} htmlFor="h-name" error={e.name?.message}><Input id="h-name" {...form.register('name')} /></Field>
          <Field label={t('household.address')} htmlFor="h-addr" error={e.address?.message}><Input id="h-addr" {...form.register('address')} /></Field>
          <Field label={t('household.timezone')} htmlFor="h-tz" hint={t('settings.timezoneHint')}><Select id="h-tz" {...form.register('timezone')}>{zones.map((z) => <option key={z}>{z}</option>)}</Select></Field>
          <Field label={t('household.currency')} htmlFor="h-cur" error={e.currency?.message}><Select id="h-cur" {...form.register('currency')}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
          <Field label={t('household.description')} htmlFor="h-desc" className="sm:col-span-2" error={e.description?.message}><Textarea id="h-desc" rows={2} {...form.register('description')} /></Field>
        </fieldset>
        {isAdmin && <div><Button type="submit" loading={save.isPending}>{t('common.save')}</Button></div>}
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------- members + invitations
function MembersSettings() {
  const { t, i18n } = useTranslation();
  const { userId } = useAuth();
  const { household, isAdmin, activeMembers, reload } = useCurrentHousehold();
  const [confirm, setConfirm] = useState<{ kind: 'remove' | 'transfer' | 'promote' | 'demote'; member: MemberInfo } | null>(null);
  const after = { groups: ['members' as const, 'tasks' as const], onSuccess: () => { setConfirm(null); void reload(); } };
  const remove = useAction(async (m: MemberInfo) => unwrap(await supabase.rpc('remove_member', { p_household: household.id, p_user: m.user_id })), { ...after, success: 'settings.memberRemoved' });
  const role = useAction(async ({ m, r }: { m: MemberInfo; r: 'admin' | 'member' }) => unwrap(await supabase.rpc('set_member_role', { p_household: household.id, p_user: m.user_id, p_role: r })), { ...after, success: 'common.saved' });
  const transfer = useAction(async (m: MemberInfo) => unwrap(await supabase.rpc('transfer_admin', { p_household: household.id, p_new_admin: m.user_id })), { ...after, success: 'settings.adminTransferred' });
  const busy = remove.isPending || role.isPending || transfer.isPending;
  const run = () => {
    if (!confirm) return;
    const m = confirm.member;
    if (confirm.kind === 'remove') remove.mutate(m);
    else if (confirm.kind === 'transfer') transfer.mutate(m);
    else role.mutate({ m, r: confirm.kind === 'promote' ? 'admin' : 'member' });
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={t('settings.members', { count: activeMembers.length })}>
        <p className="mb-3 text-xs text-slate-500">{t('settings.rolesHint')}</p>
        <ul className="divide-y divide-slate-100">
          {activeMembers.map((m) => (
            <li key={m.user_id} className="flex flex-wrap items-center gap-3 py-3">
              <Avatar name={m.display_name} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{m.display_name}{m.user_id === userId && <span className="text-slate-500"> ({t('common.you')})</span>}</p>
                <p className="text-xs text-slate-500">{t('settings.joined', { date: formatDate(m.joined_at.slice(0, 10), i18n.language) })}</p>
              </div>
              <Badge tone={m.role === 'admin' ? 'blue' : 'gray'}>{t(`roles.${m.role}`)}</Badge>
              {isAdmin && m.user_id !== userId && (
                <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                  {m.role === 'member'
                    ? <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: 'promote', member: m })}>{t('settings.makeAdmin')}</Button>
                    : <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: 'demote', member: m })}>{t('settings.removeAdmin')}</Button>}
                  <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: 'transfer', member: m })}>{t('settings.transferAdmin')}</Button>
                  <Button size="sm" variant="ghost" className="text-red-700" onClick={() => setConfirm({ kind: 'remove', member: m })}>{t('settings.removeMember')}</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
      {isAdmin ? <Invitations /> : <Card title={t('settings.invitations')}><p className="text-sm text-slate-600">{t('settings.inviteAdminOnly')}</p></Card>}
      <ConfirmDialog open={Boolean(confirm)} danger={confirm?.kind === 'remove'}
        title={confirm ? t(`settings.confirm.${confirm.kind}.title`) : ''}
        message={confirm ? t(`settings.confirm.${confirm.kind}.message`, { name: confirm.member.display_name }) : ''}
        loading={busy} onCancel={() => setConfirm(null)} onConfirm={run} />
    </div>
  );
}

const inviteSchema = z.object({
  email: z.union([z.literal(''), z.string().trim().email('validation.email')]).optional(),
  valid_hours: z.coerce.number().int().min(1).max(720),
  max_uses: z.coerce.number({ invalid_type_error: 'validation.number' }).int('validation.number').min(1, 'validation.range').max(50, 'validation.range'),
});
type InviteForm = z.infer<typeof inviteSchema>;

function Invitations() {
  const { t, i18n } = useTranslation();
  const { household, memberName } = useCurrentHousehold();
  const [created, setCreated] = useState<{ link: string; email: string | null; expires: string } | null>(null);
  const [revoking, setRevoking] = useState<Invitation | null>(null);
  const list = useHHQuery('members', ['invitations'], async (hh) =>
    unwrap(await supabase.from('household_invitations').select('id, household_id, email, expires_at, max_uses, use_count, revoked_at, created_at, created_by')
      .eq('household_id', hh).order('created_at', { ascending: false }).limit(30)) as Invitation[]);
  const form = useForm<InviteForm>({ resolver: zodResolver(inviteSchema), defaultValues: { email: '', valid_hours: 72, max_uses: 1 } });
  const create = useAction(async (v: InviteForm) => {
    const rows = unwrap(await supabase.rpc('create_invitation', { p_household: household.id, p_email: v.email || null, p_valid_hours: v.valid_hours, p_max_uses: v.max_uses })) as { token: string; expires_at: string }[];
    return { ...rows[0], email: v.email || null };
  }, { groups: ['members'], success: 'settings.inviteCreated', onSuccess: (r) => {
    setCreated({ link: `${window.location.origin}/join/${r.token}`, email: r.email, expires: r.expires_at });
    form.reset({ email: '', valid_hours: 72, max_uses: 1 });
  } });
  const revoke = useAction(async (inv: Invitation) => unwrap(await supabase.rpc('revoke_invitation', { p_invitation: inv.id })), { groups: ['members'], success: 'settings.inviteRevoked', onSuccess: () => setRevoking(null) });
  const now = new Date().toISOString();
  const state = (i: Invitation) => i.revoked_at ? 'revoked' : i.expires_at <= now ? 'expired' : i.use_count >= i.max_uses ? 'used' : 'active';
  const e = form.formState.errors;
  return (
    <Card title={t('settings.invitations')}>
      <form className="grid gap-3 sm:grid-cols-3" onSubmit={form.handleSubmit((v) => create.mutate(v))} noValidate>
        <Field label={t('settings.inviteEmail')} htmlFor="i-email" className="sm:col-span-3" error={e.email?.message} hint={t('settings.inviteEmailHint')}><Input id="i-email" type="email" autoComplete="off" {...form.register('email')} /></Field>
        <Field label={t('settings.validFor')} htmlFor="i-valid"><Select id="i-valid" {...form.register('valid_hours')}>
          {[24, 72, 168, 720].map((h) => <option key={h} value={h}>{t('settings.hours', { count: h })}</option>)}
        </Select></Field>
        <Field label={t('settings.maxUses')} htmlFor="i-uses" error={e.max_uses?.message}><Input id="i-uses" type="number" min={1} max={50} {...form.register('max_uses')} /></Field>
        <div className="flex items-end"><Button type="submit" icon="link" loading={create.isPending} className="w-full">{t('settings.createInvite')}</Button></div>
      </form>
      <h3 className="mb-2 mt-6 text-sm font-semibold text-slate-700">{t('settings.inviteList')}</h3>
      {list.isLoading ? <LoadingState /> : !list.data?.length ? <p className="text-sm text-slate-500">{t('settings.noInvites')}</p> : (
        <ul className="divide-y divide-slate-100 text-sm">
          {list.data.map((i) => {
            const s = state(i);
            return (
              <li key={i.id} className="flex flex-wrap items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p>{i.email ?? t('settings.anyoneWithLink')}</p>
                  <p className="text-xs text-slate-500">{t('settings.inviteMeta', { uses: i.use_count, max: i.max_uses, date: formatDateTime(i.expires_at, i18n.language, household.timezone), by: memberName(i.created_by) })}</p>
                </div>
                <Badge tone={s === 'active' ? 'green' : 'gray'}>{t(`settings.inviteState.${s}`)}</Badge>
                {s === 'active' && <Button size="sm" variant="ghost" className="text-red-700" onClick={() => setRevoking(i)}>{t('settings.revoke')}</Button>}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-xs text-slate-500">{t('settings.inviteSecurityNote')}</p>
      {created && <InviteCreated {...created} household={household.name} onClose={() => setCreated(null)} />}
      <ConfirmDialog open={Boolean(revoking)} title={t('settings.revoke')} message={t('settings.revokeConfirm')} loading={revoke.isPending}
        onCancel={() => setRevoking(null)} onConfirm={() => revoking && revoke.mutate(revoking)} />
    </Card>
  );
}

function InviteCreated({ link, email, expires, household, onClose }: { link: string; email: string | null; expires: string; household: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { household: hh } = useCurrentHousehold();
  const message = t('settings.inviteMessage', { household, link });
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); toast.success(t('settings.copied')); } catch { toast.error(new Error('clipboard')); }
  };
  const share = async () => {
    try { await navigator.share({ title: 'HomeHub', text: message, url: link }); } catch { /* user cancelled */ }
  };
  const mailto = `mailto:${encodeURIComponent(email ?? '')}?subject=${encodeURIComponent(t('settings.inviteSubject', { household }))}&body=${encodeURIComponent(message)}`;
  return (
    <Modal open onClose={onClose} title={t('settings.inviteReady')} footer={<Button onClick={onClose}>{t('common.close')}</Button>}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">{t('settings.inviteOnce')}</p>
        <div className="flex gap-2">
          <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label={t('settings.inviteLink')} />
          <Button variant="secondary" icon="copy" onClick={() => void copy()}>{t('settings.copy')}</Button>
        </div>
        <p className="text-xs text-slate-500">{t('settings.expires', { date: formatDateTime(expires, i18n.language, hh.timezone) })}{email ? ` · ${t('settings.onlyFor', { email })}` : ''}</p>
        <div className="flex flex-wrap gap-2">
          {canShare && <Button variant="secondary" icon="link" onClick={() => void share()}>{t('settings.share')}</Button>}
          <a href={mailto} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50"><Icon name="mail" className="h-4 w-4" />{t('settings.openEmail')}</a>
        </div>
        <p className="text-xs text-slate-500">{t('settings.emailNotSentNote')}</p>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- households
function HouseholdsSettings() {
  const { t } = useTranslation();
  const { households, household, selectHousehold, reload, isAdmin, activeMembers } = useCurrentHousehold();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [leaving, setLeaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const admins = activeMembers.filter((m) => m.role === 'admin').length;
  const lastAdmin = isAdmin && admins <= 1 && activeMembers.length > 1;
  const leave = useAction(async () => unwrap(await supabase.rpc('leave_household', { p_household: household.id })), {
    groups: ['members'], success: 'settings.left', onSuccess: async () => {
      setLeaving(false);
      const other = households.find((h) => h.id !== household.id);
      if (other) selectHousehold(other.id);
      await reload();
      await qc.invalidateQueries();
      navigate(other ? '/' : '/welcome', { replace: true });
    },
  });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={t('settings.yourHouseholds')} action={<Button size="sm" variant="ghost" icon="plus" onClick={() => setCreating(true)}>{t('household.create')}</Button>}>
        <ul className="divide-y divide-slate-100">
          {households.map((h) => (
            <li key={h.id} className="flex items-center gap-3 py-3">
              <Icon name="home" className="h-5 w-5 text-slate-500" />
              <div className="min-w-0 flex-1"><p className="font-medium">{h.name}</p><p className="text-xs text-slate-500">{t(`roles.${h.role}`)}</p></div>
              {h.id === household.id ? <Badge tone="green">{t('settings.current')}</Badge>
                : <Button size="sm" variant="secondary" onClick={() => { selectHousehold(h.id); navigate('/'); }}>{t('settings.switch')}</Button>}
            </li>
          ))}
        </ul>
      </Card>
      <Card title={t('settings.leaveTitle', { name: household.name })}>
        <p className="text-sm text-slate-600">{lastAdmin ? t('settings.lastAdminNote') : t('settings.leaveNote')}</p>
        <Button className="mt-3" variant="danger" disabled={lastAdmin} onClick={() => setLeaving(true)}>{t('settings.leave')}</Button>
      </Card>
      <ConfirmDialog open={leaving} title={t('settings.leave')} message={t('settings.leaveConfirm', { name: household.name })} loading={leave.isPending}
        onCancel={() => setLeaving(false)} onConfirm={() => leave.mutate(undefined)} />
      {creating && <Modal open onClose={() => setCreating(false)} size="lg" title={t('household.create')}><WelcomePage embedded /></Modal>}
    </div>
  );
}
