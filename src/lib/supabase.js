import { createClient } from '@supabase/supabase-js';

// The anon key is public by design: it ships inside the browser bundle and is
// visible to anyone who opens the app. It grants nothing on its own. Row Level
// Security is the authorisation boundary, and every policy requires an
// authenticated user, so an anon reader sees an empty database.
//
// The service role key must never appear here. It bypasses RLS entirely and is
// used only by scripts/seed.mjs, from a terminal.

// Hosting dashboards happily store a value with surrounding quotes or stray
// whitespace, and Vite inlines whatever it is given, verbatim.
const clean = (v) => (typeof v === 'string' ? v.trim().replace(/^["']|["']$/g, '') : v);

const url = clean(import.meta.env.VITE_SUPABASE_URL);
const anonKey = clean(import.meta.env.VITE_SUPABASE_ANON_KEY);

function check() {
  if (!url && !anonKey) {
    return 'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not set.';
  }
  if (!url) return 'VITE_SUPABASE_URL is not set.';
  if (!anonKey) return 'VITE_SUPABASE_ANON_KEY is not set.';

  // createClient throws on a malformed URL, and a throw at module load renders
  // a blank white page with the reason buried in the console. Checking the
  // shape here turns the commonest mistakes into a sentence on screen.
  if (!/^https?:\/\//i.test(url)) {
    return `VITE_SUPABASE_URL is "${url}", which is not a URL. It should look like https://xxxxxxxx.supabase.co — copy the Project URL from Supabase, Settings then API.`;
  }
  if (/supabase\.com\/dashboard/i.test(url)) {
    return `VITE_SUPABASE_URL is the dashboard address, not the project API URL. It should look like https://xxxxxxxx.supabase.co, from Settings then API.`;
  }
  if (anonKey.length < 30) {
    return 'VITE_SUPABASE_ANON_KEY looks too short to be a key. Copy the anon / public key from Supabase, Settings then API.';
  }
  return null;
}

let error = check();
let client = null;

if (!error) {
  try {
    client = createClient(url, anonKey);
  } catch (e) {
    error = `Supabase rejected these settings: ${e.message}`;
  }
}

export const configError = error;
export const supabase = client;
