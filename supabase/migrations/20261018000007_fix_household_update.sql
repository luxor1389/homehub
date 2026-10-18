-- Fix: admins could not save household settings ("permission denied for function is_valid_timezone").
-- The households_validate trigger runs as the calling user and calls private.is_valid_timezone,
-- but only anon/public had been revoked and authenticated was never granted execute on it.
-- The helper only reads pg_timezone_names, so letting signed-in users run it exposes nothing.
-- Who may update a household is still decided by the households_update RLS policy (admins only).
grant execute on function private.is_valid_timezone(text) to authenticated, service_role;
