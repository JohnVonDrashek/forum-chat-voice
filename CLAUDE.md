# Forum Chat Voice

## Testing

**Always test through production**: https://forum-chat-voice.vercel.app

Do NOT use local dev server for testing. Use Playwright to interact with the production site.

## Deployment
Do NOT deploy this project from vercel directly. Vercel has a workflow to auto-deploy from our Github project.

## Vercel
The Vercel CLI token is stored in macOS Keychain under `vercel-token`.

## Stack

- React 19 + Vite + TailwindCSS
- Supabase (auth, database, realtime)
- LiveKit (voice rooms)
- Deployed on Vercel
