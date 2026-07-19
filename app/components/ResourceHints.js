'use client';

import ReactDOM from 'react-dom';

export default function ResourceHints() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (supabaseUrl) {
    try {
      ReactDOM.preconnect(new URL(supabaseUrl).origin, { crossOrigin: '' });
    } catch {
      // Ignore malformed local env values; rendering must stay resilient.
    }
  }

  return null;
}
