import { supabase } from '@/lib/supabase';
import { unwrap, useHHQuery } from '@/lib/hooks';
import type { Pet, PetCareRecord } from '@/lib/types';

export function usePets() {
  return useHHQuery('pets', ['list'], async (hh) =>
    unwrap(await supabase.from('pets').select('*').eq('household_id', hh).is('archived_at', null).order('name')) as Pet[]);
}
export function usePetCare(petId?: string) {
  return useHHQuery('pets', ['care', petId ?? 'all'], async (hh) => {
    let q = supabase.from('pet_care_records').select('*').eq('household_id', hh);
    if (petId) q = q.eq('pet_id', petId);
    return unwrap(await q.order('occurred_on', { ascending: false }).order('created_at', { ascending: false }).limit(500)) as PetCareRecord[];
  });
}
/** Latest record per (pet, kind) that has a next due date. */
export function upcomingPetCare(records: PetCareRecord[]): PetCareRecord[] {
  const seen = new Set<string>();
  const out: PetCareRecord[] = [];
  for (const r of records) {
    const k = `${r.pet_id}:${r.kind}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (r.next_due_on) out.push(r);
  }
  return out.sort((a, b) => a.next_due_on!.localeCompare(b.next_due_on!));
}
