#!/usr/bin/env bash
# Re-creates the app schema on the local test database and applies all migrations in order.
# Local test harness only (plain PostgreSQL + GoTrue + PostgREST). Never point this at a real project.
set -euo pipefail
export PGOPTIONS="-c client_min_messages=warning"
DB_URL="${DB_URL:-postgres://postgres@localhost:54322/postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -o /dev/null <<'SQL'
do $$ begin if exists (select 1 from pg_namespace where nspname = 'cron') then perform cron.unschedule('homehub-refresh'); end if; exception when others then null; end $$;
drop schema if exists public cascade;
drop schema if exists private cascade;
create schema public;
grant usage on schema public to anon, authenticated, service_role;
grant all on schema public to postgres;
delete from storage.objects;
delete from storage.buckets;
drop policy if exists "household files: members read" on storage.objects;
drop policy if exists "household files: members upload" on storage.objects;
drop policy if exists "household files: members update" on storage.objects;
drop policy if exists "household files: members delete" on storage.objects;
drop trigger if exists on_auth_user_created on auth.users;
truncate auth.users cascade;
SQL
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "applying $(basename "$f")"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -o /dev/null -f "$f"
done
if [ -f "$ROOT/supabase/seed.sql" ] && [ "${SEED:-0}" = "1" ]; then
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -o /dev/null -f "$ROOT/supabase/seed.sql"
fi
echo "database reset OK"
psql "$DB_URL" -q -c "notify pgrst, 'reload schema'" >/dev/null 2>&1 || true
