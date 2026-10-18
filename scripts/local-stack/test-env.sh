# source me: exports keys for the local harness
set -a; . /opt/sbstack/keys.env; set +a
export SUPABASE_URL=http://localhost:54321 SUPABASE_ANON_KEY=$ANON_KEY SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
