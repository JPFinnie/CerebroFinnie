/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_CEREBRO_LOGIN_EMAIL?: string;
  readonly VITE_CEREBRO_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
