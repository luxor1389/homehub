import type { Freq, RoomKind } from '@/lib/types';

// Built-in cleaning presets. Titles come from translations (cleaning.presets.<key>) at the moment the user
// creates a task, after which the stored title is the user's own text and is not re-translated.
export interface CleaningPreset {
  key: string;
  room: RoomKind | null;
  freq: Freq;
  interval?: number;
  minutes: number;
}
export const CLEANING_PRESETS: CleaningPreset[] = [
  { key: 'vacuuming', room: 'living_room', freq: 'weekly', minutes: 30 },
  { key: 'mopping', room: 'kitchen', freq: 'weekly', minutes: 30 },
  { key: 'dusting', room: 'living_room', freq: 'weekly', minutes: 20 },
  { key: 'bathroom', room: 'bathroom', freq: 'weekly', minutes: 40 },
  { key: 'fridge', room: 'kitchen', freq: 'monthly', minutes: 30 },
  { key: 'stove', room: 'kitchen', freq: 'weekly', minutes: 20 },
  { key: 'laundry', room: null, freq: 'weekly', interval: 1, minutes: 60 },
  { key: 'bed_linen', room: 'bedroom', freq: 'weekly', interval: 2, minutes: 20 },
  { key: 'windows', room: 'windows', freq: 'monthly', interval: 3, minutes: 90 },
  { key: 'trash', room: 'kitchen', freq: 'daily', interval: 2, minutes: 5 },
  { key: 'recycling', room: null, freq: 'weekly', minutes: 10 },
  { key: 'seasonal', room: null, freq: 'monthly', interval: 6, minutes: 240 },
];
export const SUBCATEGORY_KEYS = new Set(CLEANING_PRESETS.map((p) => p.key));
