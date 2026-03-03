# Forum Chat Voice

## Testing

**Always test through production**: https://forum-chat-voice.vercel.app

Do NOT use local dev server for testing. Use Playwright to interact with the production site.

## Deployment

**Forum app** (forum-chat-voice.vercel.app): Auto-deploys from GitHub on push to main. Do NOT deploy via Vercel CLI.

**Forumline Hub** (forumline-hub.vercel.app): Auto-deploys via GitHub Action (`.github/workflows/deploy-hub.yml`) when files in `hub/` change on main. The action uses the `VERCEL_TOKEN` GitHub secret.

## Vercel
The Vercel CLI token is stored in macOS Keychain under `vercel-token`.

## Supabase
The Supabase personal access token is stored in macOS Keychain under `supabase-access-token`.

## Stack

- React 19 + Vite + TailwindCSS
- Supabase (auth, database, realtime)
- LiveKit (voice rooms)
- Deployed on Vercel
