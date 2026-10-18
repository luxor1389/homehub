# Arhitektura i bezbednost

## Model podataka (ukratko)

- `profiles` (1:1 sa `auth.users`), `households`, `household_members` (uloga, status), `household_invitations`.
- `rooms`, `tasks` (pravilo ponavljanja) → `task_occurrences` (pojedinačni termini, jedinstveni po danu),
  `task_assignees` / `task_occurrence_assignees`, `task_checklist_items` / `_progress`, `task_comments`, `task_templates`.
- `shopping_lists`, `shopping_items`, `pantry_items`, `recipes`, `meal_plans`, `meal_ingredients`.
- `bills`, `expenses`, pogled `budget_entries`.
- `vehicles`, `vehicle_maintenance`, `pets`, `pet_care_records`, `plants`, `plant_care_records`, pogled `plant_status`.
- `attachments` + Storage bucket `household-files` (putanja `<household_id>/...`).
- `notifications`, `notification_deliveries`, `activity_log`.

## Bezbednost

- RLS je uključen na svim tabelama. Pristup: `household_id in (select private.my_household_ids())`
  (samo aktivni članovi). Funkcije za proveru su `SECURITY DEFINER` sa praznim `search_path`.
- Složeni strani ključevi `(id, household_id)` sprečavaju vezivanje podataka iz dva domaćinstva.
- Trigger `row_guard` postavlja `created_by` iz `auth.uid()` i zaključava `id`, `household_id`,
  `created_by`, `created_at`.
- Polja kojima upravlja server (plaćanje računa, ko je završio zadatak, uloge, pozivnice) klijent ne može
  da menja direktno: dozvole po kolonama + RPC funkcije koje proveravaju članstvo i ulogu.
- Članstvo se menja isključivo kroz RPC (`accept_invitation`, `remove_member`, `transfer_admin`…).
- Tokeni pozivnica: oko 244 bita slučajnosti, u bazi samo SHA-256 heš, rok, broj korišćenja, opoziv.
- Anonimni korisnici nemaju pristup tabelama.
- Frontend koristi samo javni anon ključ; service role ključ se ne koristi nigde u aplikaciji.
- Lozinke i tokeni se ne loguju; greške se korisniku prikazuju preko prevedenih kodova.

## Frontend

- TanStack Query ključevi `['hh', householdId, grupa, ...]`; Realtime kanal po domaćinstvu poništava
  odgovarajuće grupe, a dok Realtime ne radi, aplikacija osvežava podatke na `VITE_REALTIME_FALLBACK_POLL_MS`.
- Sve izmene idu kroz `useAction`: poruka o uspehu tek kada server potvrdi, prevedena greška inače.
- Rokovi i „danas“ se računaju u vremenskoj zoni domaćinstva.
