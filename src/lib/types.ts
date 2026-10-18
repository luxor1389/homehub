// Row types of the tables the app uses (kept in sync with supabase/migrations).
export type Locale = 'sr-Latn' | 'en';
export type Role = 'admin' | 'member';
export type TaskStatus = 'planned' | 'in_progress' | 'done' | 'cancelled';
export type Priority = 'low' | 'normal' | 'high' | 'urgent';
export type Freq = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export const TASK_CATEGORIES = ['cleaning', 'maintenance', 'shopping', 'cooking', 'bills', 'vehicles', 'pets', 'plants', 'other'] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];
export const ROOM_KINDS = ['kitchen', 'living_room', 'bathroom', 'bedroom', 'hallway', 'terrace', 'windows', 'storage', 'other'] as const;
export type RoomKind = (typeof ROOM_KINDS)[number];
export const UNITS = ['pcs', 'kg', 'g', 'l', 'ml', 'pack', 'bottle', 'box', 'tbsp', 'tsp', 'cup', 'other'] as const;
export type Unit = (typeof UNITS)[number];
export const SHOP_CATEGORIES = ['food', 'hygiene', 'cleaning', 'household', 'pets', 'plants', 'other'] as const;
export type ShopCategory = (typeof SHOP_CATEGORIES)[number];
export const BILL_CATEGORIES = ['electricity', 'water', 'heating', 'internet_phone', 'building', 'insurance', 'subscriptions', 'taxes', 'repairs', 'other'] as const;
export const EXPENSE_CATEGORIES = ['electricity', 'water', 'heating', 'internet_phone', 'building', 'insurance', 'subscriptions', 'taxes', 'repairs', 'groceries', 'household', 'vehicles', 'pets', 'plants', 'health', 'other'] as const;
export const BILL_FREQUENCIES = ['once', 'monthly', 'bimonthly', 'quarterly', 'semiannual', 'yearly'] as const;
export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type MealType = (typeof MEAL_TYPES)[number];
export const MAINTENANCE_KINDS = ['service', 'repair', 'tires', 'registration', 'inspection', 'insurance', 'fuel', 'parking', 'toll', 'wash', 'other'] as const;
export const PET_SPECIES = ['dog', 'cat', 'bird', 'fish', 'rodent', 'reptile', 'other'] as const;
export const PET_CARE_KINDS = ['feeding', 'grooming', 'cleaning', 'food_purchase', 'vet_visit', 'vaccination', 'treatment', 'medication', 'other'] as const;
export const PLANT_CARE_KINDS = ['watering', 'fertilizing', 'repotting', 'pruning', 'treatment', 'other'] as const;
export const LIGHT_NEEDS = ['low', 'medium', 'bright_indirect', 'direct'] as const;

export interface Profile {
  id: string;
  display_name: string;
  locale: Locale;
  avatar_path: string | null;
  email_notifications: boolean;
}
export interface Household {
  id: string;
  name: string;
  description: string | null;
  address: string | null;
  timezone: string;
  currency: string;
  created_by: string | null;
  created_at: string;
}
export interface Member {
  id: string;
  household_id: string;
  user_id: string;
  role: Role;
  status: 'active' | 'removed' | 'left';
  joined_at: string;
}
export interface Room {
  id: string;
  household_id: string;
  kind: RoomKind;
  name: string | null;
  sort_order: number;
  archived_at: string | null;
}
export interface Task {
  id: string;
  household_id: string;
  title: string;
  description: string | null;
  category: TaskCategory;
  subcategory: string | null;
  room_id: string | null;
  vehicle_id: string | null;
  pet_id: string | null;
  plant_id: string | null;
  priority: Priority;
  estimated_minutes: number | null;
  start_date: string;
  due_time: string | null;
  recurrence_freq: Freq;
  recurrence_interval: number;
  recurrence_weekdays: number[] | null;
  recurrence_until: string | null;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
export interface Occurrence {
  id: string;
  household_id: string;
  task_id: string;
  scheduled_date: string;
  due_date: string;
  due_time: string | null;
  due_at: string;
  status: TaskStatus;
  is_overdue: boolean;
  title: string;
  description: string | null;
  category: TaskCategory;
  subcategory: string | null;
  room_id: string | null;
  vehicle_id: string | null;
  pet_id: string | null;
  plant_id: string | null;
  priority: Priority;
  estimated_minutes: number | null;
  recurrence_freq: Freq;
  recurrence_interval: number;
  has_overrides: boolean;
  started_at: string | null;
  completed_at: string | null;
  completed_by: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  assignee_ids: string[];
  created_at: string;
  updated_at: string;
  created_by: string | null;
}
export interface ChecklistItem {
  id: string;
  task_id: string;
  position: number;
  label: string;
}
export interface TaskComment {
  id: string;
  task_id: string;
  occurrence_id: string | null;
  kind: 'comment' | 'agreement' | 'swap';
  body: string;
  agreed_due_date: string | null;
  swap_with: string | null;
  created_by: string | null;
  created_at: string;
}
export interface TaskTemplate {
  id: string;
  household_id: string;
  title: string;
  description: string | null;
  category: TaskCategory;
  subcategory: string | null;
  room_id: string | null;
  priority: Priority;
  estimated_minutes: number | null;
  recurrence_freq: Freq;
  recurrence_interval: number;
  recurrence_weekdays: number[] | null;
  checklist: string[];
}
export interface ShoppingList {
  id: string;
  household_id: string;
  name: string | null;
  is_default: boolean;
}
export interface ShoppingItem {
  id: string;
  household_id: string;
  list_id: string;
  name: string;
  normalized_name: string;
  quantity: number;
  unit: Unit | null;
  category: ShopCategory;
  priority: 'low' | 'normal' | 'high';
  note: string | null;
  status: 'needed' | 'purchased';
  price: number | null;
  currency: string;
  purchased_by: string | null;
  purchased_at: string | null;
  meal_plan_id: string | null;
  created_by: string | null;
  created_at: string;
}
export interface PantryItem {
  id: string;
  household_id: string;
  name: string;
  quantity: number;
  min_quantity: number | null;
  unit: Unit | null;
  category: ShopCategory;
}
export interface Recipe {
  id: string;
  household_id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  prep_minutes: number | null;
  servings: number | null;
  is_favorite: boolean;
  source_url: string | null;
  archived_at: string | null;
}
export interface MealPlan {
  id: string;
  household_id: string;
  plan_date: string;
  meal_type: MealType;
  title: string;
  recipe_id: string | null;
  cook_id: string | null;
  prep_minutes: number | null;
  prep_on: string | null;
  servings: number | null;
  notes: string | null;
}
export interface Ingredient {
  id: string;
  household_id: string;
  recipe_id: string | null;
  meal_plan_id: string | null;
  name: string;
  quantity: number | null;
  unit: Unit | null;
  position: number;
}
export interface Bill {
  id: string;
  household_id: string;
  series_id: string;
  name: string;
  category: string;
  amount: number;
  currency: string;
  due_date: string;
  frequency: string;
  status: 'unpaid' | 'paid';
  paid_amount: number | null;
  paid_on: string | null;
  paid_at: string | null;
  paid_by: string | null;
  responsible_id: string | null;
  remind_days_before: number;
  notes: string | null;
  archived_at: string | null;
}
export interface Expense {
  id: string;
  household_id: string;
  category: string;
  description: string;
  amount: number;
  currency: string;
  spent_on: string;
  kind: 'planned' | 'actual';
  paid_by: string | null;
  notes: string | null;
  archived_at: string | null;
}
export interface BudgetEntry {
  household_id: string;
  source: 'expense' | 'bill' | 'vehicle' | 'pet' | 'shopping';
  source_id: string;
  category: string;
  description: string;
  amount: number;
  currency: string;
  entry_date: string;
  paid_by: string | null;
  kind: 'planned' | 'actual';
}
export interface Vehicle {
  id: string;
  household_id: string;
  make: string;
  model: string | null;
  year: number | null;
  plate: string | null;
  odometer_km: number | null;
  registration_date: string | null;
  registration_expires_on: string | null;
  insurance_company: string | null;
  insurance_policy: string | null;
  insurance_expires_on: string | null;
  inspection_due_on: string | null;
  tire_season: 'summer' | 'winter' | 'all_season' | null;
  next_tire_change_on: string | null;
  next_service_on: string | null;
  next_service_km: number | null;
  notes: string | null;
  photo_path: string | null;
  archived_at: string | null;
}
export interface VehicleMaintenance {
  id: string;
  household_id: string;
  vehicle_id: string;
  kind: string;
  performed_on: string;
  odometer_km: number | null;
  description: string | null;
  cost: number | null;
  currency: string;
  liters: number | null;
  full_tank: boolean;
  created_by: string | null;
}
export interface Pet {
  id: string;
  household_id: string;
  name: string;
  species: string;
  breed: string | null;
  birth_date: string | null;
  feeding_plan: string | null;
  notes: string | null;
  photo_path: string | null;
  archived_at: string | null;
}
export interface PetCareRecord {
  id: string;
  household_id: string;
  pet_id: string;
  kind: string;
  occurred_on: string;
  next_due_on: string | null;
  description: string | null;
  cost: number | null;
  currency: string;
  performed_by: string | null;
  created_by: string | null;
}
export interface Plant {
  id: string;
  household_id: string;
  name: string;
  species: string | null;
  location: string | null;
  room_id: string | null;
  watering_interval_days: number | null;
  fertilizing_interval_days: number | null;
  light_needs: string | null;
  repotting_notes: string | null;
  notes: string | null;
  photo_path: string | null;
  archived_at: string | null;
}
export interface PlantStatus {
  plant_id: string;
  household_id: string;
  last_watered_on: string | null;
  last_fertilized_on: string | null;
  next_watering_on: string | null;
  next_fertilizing_on: string | null;
}
export interface PlantCareRecord {
  id: string;
  household_id: string;
  plant_id: string;
  kind: string;
  occurred_on: string;
  notes: string | null;
  performed_by: string | null;
  created_by: string | null;
}
export interface Attachment {
  id: string;
  household_id: string;
  entity_type: string;
  entity_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_by: string | null;
  created_at: string;
}
export interface AppNotification {
  id: string;
  household_id: string;
  user_id: string;
  type: string;
  entity_type: string | null;
  entity_id: string | null;
  params: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}
export interface NotificationDelivery {
  id: string;
  notification_id: string;
  channel: 'email' | 'push';
  status: 'pending' | 'sent' | 'failed' | 'skipped';
}
export interface ActivityEntry {
  id: string;
  household_id: string;
  actor_id: string | null;
  entity_type: string;
  entity_id: string | null;
  parent_id: string | null;
  action: string;
  label: string | null;
  details: { fields?: string[]; from?: string; to?: string; due_from?: string; due_to?: string };
  created_at: string;
}
export interface Invitation {
  id: string;
  household_id: string;
  email: string | null;
  expires_at: string;
  max_uses: number;
  use_count: number;
  revoked_at: string | null;
  created_at: string;
  created_by: string | null;
}
