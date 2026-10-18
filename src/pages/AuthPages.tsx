import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { applyLocale, LOCALES } from '@/i18n';
import { errorKey } from '@/lib/errors';
import { Button, Field, Input, Select } from '@/components/ui/ui';
import type { Locale } from '@/lib/types';

function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export function LanguageSwitch() {
  const { t, i18n } = useTranslation();
  return (
    <Select aria-label={t('settings.language')} className="w-auto" value={i18n.language}
      onChange={(e) => applyLocale(e.target.value as Locale)}>
      {LOCALES.map((l) => <option key={l} value={l}>{t(`languages.${l}`)}</option>)}
    </Select>
  );
}

function AuthLayout({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-brand-50 to-slate-50 px-4 py-10">
      <div className="absolute right-4 top-4"><LanguageSwitch /></div>
      <div className="mb-6 flex items-center gap-2">
        <img src="/icon.svg" alt="" className="h-10 w-10" />
        <span className="text-2xl font-bold text-brand-800">HomeHub</span>
      </div>
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="mb-4 text-xl font-semibold">{title}</h1>
        {children}
      </div>
      {footer && <div className="mt-4 text-center text-sm text-slate-600">{footer}</div>}
    </div>
  );
}

function FormError({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  return <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{t(errorKey(error).key)}</p>;
}

const loginSchema = z.object({
  email: z.string().trim().min(1, 'validation.required').email('validation.email'),
  password: z.string().min(1, 'validation.required'),
});

export function LoginPage() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [error, setError] = useState<unknown>(null);
  const form = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema) });
  if (session) return <Navigate to={next} replace />;
  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    const { error } = await supabase.auth.signInWithPassword(v);
    if (error) setError(error);
  });
  return (
    <AuthLayout title={t('auth.login')} footer={<>
      {t('auth.noAccount')} <Link className="font-medium text-brand-700 underline" to={`/register?next=${encodeURIComponent(next)}`}>{t('auth.register')}</Link>
    </>}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label={t('auth.email')} htmlFor="email" error={form.formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" {...form.register('email')} aria-invalid={!!form.formState.errors.email} />
        </Field>
        <Field label={t('auth.password')} htmlFor="password" error={form.formState.errors.password?.message}>
          <Input id="password" type="password" autoComplete="current-password" {...form.register('password')} aria-invalid={!!form.formState.errors.password} />
        </Field>
        <FormError error={error} />
        <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>{t('auth.login')}</Button>
        <p className="text-center text-sm"><Link className="text-brand-700 underline" to="/forgot-password">{t('auth.forgot')}</Link></p>
      </form>
    </AuthLayout>
  );
}

const registerSchema = z.object({
  display_name: z.string().trim().min(1, 'validation.required').max(80, 'validation.tooLong'),
  email: z.string().trim().min(1, 'validation.required').email('validation.email'),
  password: z.string().min(8, 'validation.passwordMin'),
  confirm: z.string(),
  locale: z.enum(['sr-Latn', 'en']),
}).refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'validation.passwordMatch' });

export function RegisterPage() {
  const { t, i18n } = useTranslation();
  const { session } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [error, setError] = useState<unknown>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const form = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { locale: (i18n.language as Locale) ?? 'sr-Latn' },
  });
  if (session) return <Navigate to={next} replace />;
  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    const { data, error } = await supabase.auth.signUp({
      email: v.email, password: v.password,
      options: { data: { display_name: v.display_name, locale: v.locale }, emailRedirectTo: `${window.location.origin}${next}` },
    });
    if (error) return setError(error);
    applyLocale(v.locale);
    if (!data.session) setNeedsConfirmation(true);
  });
  if (needsConfirmation) {
    return (
      <AuthLayout title={t('auth.checkEmailTitle')}>
        <p className="text-slate-700">{t('auth.checkEmail')}</p>
        <Link to="/login" className="mt-4 inline-block font-medium text-brand-700 underline">{t('auth.login')}</Link>
      </AuthLayout>
    );
  }
  const e = form.formState.errors;
  return (
    <AuthLayout title={t('auth.register')} footer={<>
      {t('auth.haveAccount')} <Link className="font-medium text-brand-700 underline" to={`/login?next=${encodeURIComponent(next)}`}>{t('auth.login')}</Link>
    </>}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label={t('auth.displayName')} htmlFor="display_name" error={e.display_name?.message}>
          <Input id="display_name" autoComplete="name" {...form.register('display_name')} />
        </Field>
        <Field label={t('auth.email')} htmlFor="email" error={e.email?.message}>
          <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
        </Field>
        <Field label={t('auth.password')} htmlFor="password" error={e.password?.message} hint={t('auth.passwordHint')}>
          <Input id="password" type="password" autoComplete="new-password" {...form.register('password')} />
        </Field>
        <Field label={t('auth.confirmPassword')} htmlFor="confirm" error={e.confirm?.message}>
          <Input id="confirm" type="password" autoComplete="new-password" {...form.register('confirm')} />
        </Field>
        <Field label={t('settings.language')} htmlFor="locale">
          <Select id="locale" {...form.register('locale')}>
            {LOCALES.map((l) => <option key={l} value={l}>{t(`languages.${l}`)}</option>)}
          </Select>
        </Field>
        <FormError error={error} />
        <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>{t('auth.createAccount')}</Button>
      </form>
    </AuthLayout>
  );
}

const forgotSchema = z.object({ email: z.string().trim().min(1, 'validation.required').email('validation.email') });

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const form = useForm<z.infer<typeof forgotSchema>>({ resolver: zodResolver(forgotSchema) });
  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(v.email, { redirectTo: `${window.location.origin}/reset-password` });
    if (error) setError(error); else setDone(true);
  });
  return (
    <AuthLayout title={t('auth.forgotTitle')} footer={<Link className="text-brand-700 underline" to="/login">{t('auth.backToLogin')}</Link>}>
      {done ? <p className="text-slate-700">{t('auth.resetRequested')}</p> : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label={t('auth.email')} htmlFor="email" error={form.formState.errors.email?.message}>
            <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
          </Field>
          <FormError error={error} />
          <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>{t('auth.sendResetLink')}</Button>
        </form>
      )}
    </AuthLayout>
  );
}

const resetSchema = z.object({ password: z.string().min(8, 'validation.passwordMin'), confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'validation.passwordMatch' });

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(null);
  const [ready, setReady] = useState(Boolean(session));
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY' || s) setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => { if (session) setReady(true); }, [session]);
  const form = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema) });
  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    const { error } = await supabase.auth.updateUser({ password: v.password });
    if (error) setError(error); else navigate('/', { replace: true });
  });
  return (
    <AuthLayout title={t('auth.newPassword')}>
      {!ready ? <p className="text-slate-700">{t('auth.resetLinkInvalid')}</p> : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label={t('auth.password')} htmlFor="password" error={form.formState.errors.password?.message}>
            <Input id="password" type="password" autoComplete="new-password" {...form.register('password')} />
          </Field>
          <Field label={t('auth.confirmPassword')} htmlFor="confirm" error={form.formState.errors.confirm?.message}>
            <Input id="confirm" type="password" autoComplete="new-password" {...form.register('confirm')} />
          </Field>
          <FormError error={error} />
          <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>{t('common.save')}</Button>
        </form>
      )}
    </AuthLayout>
  );
}
