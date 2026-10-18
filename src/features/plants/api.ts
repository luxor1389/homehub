import { supabase } from '@/lib/supabase';
import { unwrap, useHHQuery } from '@/lib/hooks';
import type { Plant, PlantCareRecord, PlantStatus } from '@/lib/types';

export function usePlants() {
  return useHHQuery('plants', ['list'], async (hh) => {
    const [p, s] = await Promise.all([
      supabase.from('plants').select('*').eq('household_id', hh).is('archived_at', null).order('name'),
      supabase.from('plant_status').select('*').eq('household_id', hh),
    ]);
    const status = new Map((unwrap(s) as PlantStatus[]).map((x) => [x.plant_id, x]));
    return (unwrap(p) as Plant[]).map((plant) => ({ plant, status: status.get(plant.id) ?? null }));
  });
}
export function usePlantCare(plantId: string | undefined) {
  return useHHQuery('plants', ['care', plantId], async () =>
    unwrap(await supabase.from('plant_care_records').select('*').eq('plant_id', plantId!).order('occurred_on', { ascending: false }).order('created_at', { ascending: false })) as PlantCareRecord[], Boolean(plantId));
}
