# Deployment Guide

This app is deployed on **Vercel** with **Supabase** as the backend.

## Production URLs

- **Frontend**: https://forum-chat-voice.vercel.app
- **Database**: Supabase PostgreSQL
- **Voice**: LiveKit Cloud

## Vercel CLI

The Vercel CLI token is stored in macOS Keychain under `vercel-token`.

```bash
# Get token from keychain
VERCEL_TOKEN=$(security find-generic-password -s "vercel-token" -a "vercel-cli" -w)

# List projects
vercel project ls --token "$VERCEL_TOKEN"

# List deployments
vercel ls --token "$VERCEL_TOKEN"

# List environment variables
vercel env ls --token "$VERCEL_TOKEN"

# Add environment variable
echo "value" | vercel env add VAR_NAME production --token "$VERCEL_TOKEN"

# Deploy demo to production
cd forum-demo && vercel --prod --token "$VERCEL_TOKEN"

# View deployment logs
vercel logs <deployment-url> --token "$VERCEL_TOKEN"
```

## Environment Variables

### Required for Vercel

Set via CLI or Vercel Dashboard:

| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anonymous/public key |
| `VITE_SITE_URL` | Production URL (`https://forum-chat-voice.vercel.app`) |
| `LIVEKIT_URL` | LiveKit server URL (wss://...) |
| `LIVEKIT_API_KEY` | LiveKit API key |
| `LIVEKIT_API_SECRET` | LiveKit API secret |

### Local Development

Create `forum-demo/.env.local`:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_SITE_URL=http://localhost:3000
LIVEKIT_URL=wss://your-livekit.livekit.cloud
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret
```

## Local Development

```bash
npm install        # from root — sets up workspaces
cd forum-demo && npm run dev
```

## Deployment

Vercel auto-deploys when you push to the main branch (via GitHub Actions).

Manual deploy:
```bash
cd forum-demo && vercel --prod --token "$VERCEL_TOKEN"
```

## Supabase Setup

Supabase is provisioned through the Vercel integration.

### Access Supabase Dashboard

```bash
# Open Supabase dashboard via Vercel SSO
VERCEL_TOKEN=$(security find-generic-password -s "vercel-token" -a "vercel-cli" -w)
vercel integration open supabase forum-chat-voice-db --token "$VERCEL_TOKEN"
# Opens URL in browser for SSO access
```

### Pull Environment Variables

```bash
# Pull all Supabase env vars to local
cd forum-demo && vercel env pull .env.local --token "$VERCEL_TOKEN"
```

### Auth Redirect URLs

Configure in Supabase Dashboard > Authentication > URL Configuration:

- **Site URL**: `https://forum-chat-voice.vercel.app`
- **Redirect URLs**:
  - `https://forum-chat-voice.vercel.app`
  - `https://forum-chat-voice.vercel.app/reset-password`
  - `http://localhost:3000` (for local dev)
  - `http://localhost:3000/reset-password` (for local dev)

## LiveKit Setup

1. Create a LiveKit Cloud account at https://livekit.io
2. Create a new project
3. Copy the API credentials to your environment variables
