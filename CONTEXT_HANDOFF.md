# Context Handoff: Password Reset Redirect Configuration

## Problem
Password reset emails redirect to `localhost:3000` instead of the production URL `https://forum-chat-voice.vercel.app`.

## What's Done
- Added `VITE_SITE_URL` env var support in `src/lib/auth.tsx`
- Set `VITE_SITE_URL=https://forum-chat-voice.vercel.app` in Vercel production env
- Added `PASSWORD_RECOVERY` event detection to redirect to `/reset-password`
- Deployed to Vercel

## What's Needed
Configure Supabase Auth settings to allow the production redirect URL. The Supabase project needs:
- `site_url` = `https://forum-chat-voice.vercel.app`
- `additional_redirect_urls` should include `https://forum-chat-voice.vercel.app/reset-password`

## Key Info
- Supabase project ref: `fepzwgtyqgkoswphxviv`
- Vercel token is in macOS keychain: `security find-generic-password -s "vercel-token" -a "vercel-cli" -w`
- Supabase was originally set up via CLI
- Vercel integration provides SSO access to Supabase dashboard via `vercel integration open supabase`

## Files
- `demo/src/lib/auth.tsx` - Auth context with password reset logic
- `demo/supabase/` - Directory exists but no config.toml yet
