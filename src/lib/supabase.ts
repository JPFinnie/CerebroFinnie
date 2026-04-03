import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
const configuredSiteUrl = import.meta.env.VITE_CEREBRO_SITE_URL?.trim() ?? '';

export const defaultLoginEmail = import.meta.env.VITE_CEREBRO_LOGIN_EMAIL?.trim() || 'james_finnie@icloud.com';
export const isSupabaseRuntimeEnabled = Boolean(supabaseUrl && supabasePublishableKey);
export const snapshotCacheKey = 'cerebro.snapshot-cache.v1';
export const magicLinkRedirectTo =
  normalizeUrl(configuredSiteUrl) || (typeof window !== 'undefined' ? normalizeUrl(window.location.origin) : '');

export const supabase = isSupabaseRuntimeEnabled
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    })
  : null;

function normalizeUrl(value: string) {
  if (!value) {
    return '';
  }

  try {
    return new URL(value).toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}
