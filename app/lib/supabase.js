/**
 * Lazy Supabase singleton — creat doar la primul apel (runtime), nu la build time.
 * Asta previne eroarea "supabaseKey is required" în timpul build-ului Next.js
 * când variabilele de mediu nu sunt disponibile.
 */
import { createClient } from '@supabase/supabase-js';

let _supabase = null;

export function getSupabase() {
  if (!_supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        '[supabase] Missing env vars: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'
      );
    }
    _supabase = createClient(url, key);
  }
  return _supabase;
}

/**
 * Execută un query Supabase cu retry automat la PGRST002 (schema cache reload).
 * @param {() => Promise<{data, error}>} queryFn - funcție care returnează un query Supabase
 * @param {number} maxRetries - număr maxim de reîncercări (default 3)
 * @param {number} delayMs - pauză între reîncercări în ms (default 1500)
 */
export async function supabaseQuery(queryFn, maxRetries = 3, delayMs = 1500) {
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await queryFn();
    if (!result.error || result.error.code !== 'PGRST002') {
      return result;
    }
    lastError = result.error;
    if (attempt < maxRetries) {
      console.warn(`[supabase] PGRST002 schema cache reload, retry ${attempt + 1}/${maxRetries} after ${delayMs}ms...`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return { data: null, error: lastError };
}
