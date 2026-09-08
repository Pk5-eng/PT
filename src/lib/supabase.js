import { createClient } from '@supabase/supabase-js';

// The anon key is public by design: it ships inside the browser bundle and is
// visible to anyone who opens the app. It grants nothing on its own. Row Level
// Security is the authorisation boundary, and every policy requires an
// authenticated user, so an anon reader sees an empty database.
//
// The service role key must never appear here. It bypasses RLS entirely and is
// used only by scripts/seed.mjs, from a terminal.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Vite inlines these at build time. Deliberately not thrown: a throw at module
// load renders a blank white page with the reason buried in the console, which
// is the worst way to find out you forgot an environment variable on the host.
export const configError =
  !url || !anonKey
    ? 'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not set. Add them to your host’s environment variables and redeploy, or copy .env.example to .env for local work. They are read at build time, so a redeploy is required after adding them.'
    : null;

export const supabase = configError ? null : createClient(url, anonKey);
