/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH_ANON_KEY: string
  readonly VITE_LIVEKIT_URL: string
  readonly VITE_HUB_URL: string
  readonly VITE_HUB_SUPABASE_URL: string
  readonly VITE_HUB_SUPABASE_ANON_KEY: string
  readonly VITE_SITE_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
