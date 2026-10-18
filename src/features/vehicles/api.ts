import { supabase } from '@/lib/supabase';
import { unwrap, useHHQuery } from '@/lib/hooks';
import type { Vehicle, VehicleMaintenance } from '@/lib/types';
import { addDays } from '@/lib/dates';

export function useVehicles(includeArchived = false) {
  return useHHQuery('vehicles', ['list', includeArchived], async (hh) => {
    let q = supabase.from('vehicles').select('*').eq('household_id', hh);
    if (!includeArchived) q = q.is('archived_at', null);
    return unwrap(await q.order('make')) as Vehicle[];
  });
}
export function useMaintenance(vehicleId: string | undefined) {
  return useHHQuery('vehicles', ['maintenance', vehicleId], async () =>
    unwrap(await supabase.from('vehicle_maintenance').select('*').eq('vehicle_id', vehicleId!).order('performed_on', { ascending: false }).order('created_at', { ascending: false })) as VehicleMaintenance[], Boolean(vehicleId));
}

export const VEHICLE_DATE_FIELDS = ['registration_expires_on', 'insurance_expires_on', 'inspection_due_on', 'next_tire_change_on', 'next_service_on'] as const;
export interface VehicleDue { vehicle: Vehicle; what: string; date?: string; km?: number }

/** Upcoming obligations (dates within `days`, or service km within 1000 km). */
export function vehicleObligations(vehicles: Vehicle[], today: string, days = 30): VehicleDue[] {
  const out: VehicleDue[] = [];
  const limit = addDays(today, days);
  for (const v of vehicles) {
    for (const f of VEHICLE_DATE_FIELDS) {
      const d = v[f];
      if (d && d <= limit) out.push({ vehicle: v, what: f, date: d });
    }
    if (v.next_service_km != null && v.odometer_km != null && v.odometer_km >= v.next_service_km - 1000) {
      out.push({ vehicle: v, what: 'next_service_km', km: v.next_service_km });
    }
  }
  return out.sort((a, b) => (a.date ?? '0').localeCompare(b.date ?? '0'));
}

/** Average consumption (l/100 km) between consecutive full-tank fill-ups. */
export function fuelConsumption(entries: VehicleMaintenance[]): number | null {
  const fills = entries.filter((e) => e.kind === 'fuel' && e.odometer_km != null && e.liters != null)
    .sort((a, b) => (a.odometer_km! - b.odometer_km!));
  let liters = 0;
  let km = 0;
  for (let i = 1; i < fills.length; i++) {
    if (!fills[i].full_tank || !fills[i - 1].full_tank) continue;
    const d = fills[i].odometer_km! - fills[i - 1].odometer_km!;
    if (d <= 0) continue;
    km += d;
    liters += Number(fills[i].liters);
  }
  return km > 0 ? (liters / km) * 100 : null;
}
