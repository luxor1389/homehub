import { useNavigate, useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useHousehold } from '@/household/HouseholdProvider';
import { useAuth } from '@/auth/AuthProvider';
import { Button, Card, ErrorState, LoadingState } from '@/components/ui/ui';
import { useToast } from '@/components/ui/toast';
import { formatDateTime } from '@/lib/dates';

interface Preview { household_name: string | null; invited_by: string | null; expires_at: string | null; valid: boolean; reason: string | null; already_member: boolean }

export function JoinPage() {
  const { token = '' } = useParams();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { email } = useAuth();
  const { selectHousehold, reload } = useHousehold();
  const preview = useQuery({
    queryKey: ['invite', token],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_invitation_preview', { p_token: token });
      if (error) throw error;
      return (data as Preview[])[0];
    },
  });
  const accept = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('accept_invitation', { p_token: token });
      if (error) throw error;
      return data as string;
    },
    onSuccess: async (householdId) => {
      selectHousehold(householdId);
      await reload();
      await qc.invalidateQueries();
      toast.success(t('join.joined'));
      navigate('/', { replace: true });
    },
    onError: (e) => toast.error(e),
  });
  return (
    <div className="min-h-dvh bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-md">
        <Card title={t('join.title')}>
          {preview.isLoading ? <LoadingState /> : preview.error ? <ErrorState error={preview.error} onRetry={() => void preview.refetch()} /> : preview.data && (
            <div className="space-y-4">
              {preview.data.valid || preview.data.already_member ? (
                <>
                  <p className="text-slate-700">{t('join.invitedTo', { household: preview.data.household_name, name: preview.data.invited_by ?? '—' })}</p>
                  {preview.data.expires_at && <p className="text-sm text-slate-500">{t('join.expires', { date: formatDateTime(preview.data.expires_at, i18n.language, Intl.DateTimeFormat().resolvedOptions().timeZone) })}</p>}
                  {preview.data.already_member
                    ? <Button className="w-full" onClick={() => navigate('/')}>{t('join.alreadyMember')}</Button>
                    : <Button className="w-full" size="lg" loading={accept.isPending} onClick={() => accept.mutate()}>{t('join.accept')}</Button>}
                </>
              ) : (
                <p role="alert" className="text-red-700">{t(`errors.invitation_${preview.data.reason ?? 'invalid'}`, { email })}</p>
              )}
              <Link to="/welcome" className="block text-center text-sm text-brand-700 underline">{t('common.back')}</Link>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
