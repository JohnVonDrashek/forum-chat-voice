# Forumline Demo

## Testing

**Always test through production**: https://forum-chat-voice.vercel.app

Do NOT use local dev server for testing. Use Playwright to interact with the production site.

## Deployment

Both projects deploy via GitHub Actions on push to main. Do NOT deploy via Vercel CLI or Vercel dashboard.

- **Forumline Demo** (forum-chat-voice.vercel.app): `.github/workflows/deploy-forum.yml` — triggers on `demo/` or `packages/` changes
- **Forumline Central Services** (forumline-hub.vercel.app): `.github/workflows/deploy-hub.yml` — triggers only on `central-services/` changes

Both use the `VERCEL_TOKEN` GitHub secret.

## Monorepo Structure

```
demo/              — Forumline Demo web app (Vite + React)
central-services/  — Forumline Central Services (identity service)
desktop/           — Tauri desktop app
packages/
  protocol/                  — @forumline/protocol (federation types)
  server-sdk/                — @forumline/server-sdk (protocol endpoint handlers)
  central-services-client/   — @forumline/central-services-client (headless hub API client)
  react/                     — @forumline/react (React providers, components, hooks)
```

npm workspaces are configured at root. Run `npm install` from root to link all packages.

### Package Details

- **@forumline/protocol** — Zero-dependency TypeScript types for the federation contract
- **@forumline/server-sdk** — Framework-agnostic handler factories (auth, notifications, unread) with `ForumlineServer` class
- **@forumline/central-services-client** — Headless HTTP client for cross-forum DMs (conversations, messages, profiles)
- **@forumline/react** — `ForumProvider`, `HubProvider`, `ForumRail`, `ForumWebview`, `useNativeNotifications`, `isTauri` utilities

## Vercel
The Vercel CLI token is stored in macOS Keychain under `vercel-token`.

## Supabase
The Supabase personal access token is stored in macOS Keychain under `supabase-access-token`.

## Stack

- React 19 + Vite + TailwindCSS
- Supabase (auth, database, realtime)
- LiveKit (voice rooms)
- Deployed on Vercel
