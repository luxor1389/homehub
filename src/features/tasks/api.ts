import { supabase } from '@/lib/supabase';
import { unwrap, useAction, useHHQuery } from '@/lib/hooks';
import type { ChecklistItem, Occurrence, Task, TaskComment, TaskStatus, TaskTemplate } from '@/lib/types';

export interface OccurrenceFilter {
  from?: string;
  to?: string;
  statuses?: TaskStatus[];
  taskId?: string;
  category?: string;
  limit?: number;
  orderDesc?: boolean;
  completedSince?: string;
}

export async function fetchOccurrences(householdId: string, f: OccurrenceFilter): Promise<Occurrence[]> {
  let q = supabase.from('task_occurrence_view').select('*').eq('household_id', householdId);
  if (f.from) q = q.gte('due_date', f.from);
  if (f.to) q = q.lte('due_date', f.to);
  if (f.statuses?.length) q = q.in('status', f.statuses);
  if (f.taskId) q = q.eq('task_id', f.taskId);
  if (f.category) q = q.eq('category', f.category);
  if (f.completedSince) q = q.gte('completed_at', f.completedSince);
  q = f.completedSince ? q.order('completed_at', { ascending: false })
    : q.order('due_date', { ascending: !f.orderDesc }).order('due_time', { ascending: true, nullsFirst: false });
  q = q.limit(f.limit ?? 1000);
  return unwrap(await q) as Occurrence[];
}

export function useOccurrences(key: string, f: OccurrenceFilter, enabled = true) {
  return useHHQuery('tasks', ['occ', key, f], (hh) => fetchOccurrences(hh, f), enabled);
}

export function useOccurrence(id: string | undefined) {
  return useHHQuery('tasks', ['occ-one', id], async () => {
    const res = await supabase.from('task_occurrence_view').select('*').eq('id', id!).maybeSingle();
    return unwrap(res) as Occurrence | null;
  }, Boolean(id));
}

export function useTask(id: string | undefined) {
  return useHHQuery('tasks', ['task', id], async () => unwrap(await supabase.from('tasks').select('*').eq('id', id!).maybeSingle()) as Task | null, Boolean(id));
}

export function useChecklist(taskId: string | undefined, occurrenceId: string | undefined) {
  return useHHQuery('tasks', ['checklist', taskId, occurrenceId], async () => {
    const [items, progress] = await Promise.all([
      supabase.from('task_checklist_items').select('*').eq('task_id', taskId!).order('position'),
      supabase.from('task_checklist_progress').select('item_id, done_by, done_at').eq('occurrence_id', occurrenceId!),
    ]);
    return { items: unwrap(items) as ChecklistItem[], progress: unwrap(progress) as { item_id: string; done_by: string | null; done_at: string }[] };
  }, Boolean(taskId && occurrenceId));
}

export function useComments(taskId: string | undefined) {
  return useHHQuery('tasks', ['comments', taskId], async () =>
    unwrap(await supabase.from('task_comments').select('*').eq('task_id', taskId!).order('created_at')) as TaskComment[], Boolean(taskId));
}

export function useTemplates() {
  return useHHQuery('tasks', ['templates'], async (hh) =>
    unwrap(await supabase.from('task_templates').select('*').eq('household_id', hh).is('archived_at', null).order('title')) as TaskTemplate[]);
}

export function useSetStatus() {
  return useAction(async ({ id, status }: { id: string; status: TaskStatus }) => {
    unwrap(await supabase.from('task_occurrences').update({ status }).eq('id', id).select('id').single());
    return status;
  }, { groups: ['tasks', 'notifications'], success: (s) => `tasks.statusSaved.${s}` });
}
