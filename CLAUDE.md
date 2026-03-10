## Vision

Forumline's goal is to support 1 million forums on the network. Every design decision, architecture choice, and automation should be built with that scale in mind for the long run.

## Browser Testing

Use `@playwright/cli` (installed globally) for browser interaction.

### Named sessions (`-s=name`)

Named sessions allow multiple browsers simultaneously (e.g., testing calls between two users):
- `playwright-cli -s=caller open https://app.forumline.net` — open Chrome session named "caller"
- `PLAYWRIGHT_MCP_BROWSER=webkit playwright-cli -s=callee open https://app.forumline.net` — open WebKit (Safari) session named "callee"
- Sessions persist until explicitly closed; commands target a session with `-s=name`

### Core commands

- `playwright-cli open <url>` — open browser, get snapshot
- `playwright-cli snapshot` — read current page state (accessibility tree with element refs)
- `playwright-cli click <ref>` / `fill <ref> <text>` — interact with elements
- `playwright-cli screenshot --filename /tmp/name.png` — save screenshot, then `Read` the image to view it
- `playwright-cli console info` — check console logs (filter by level: info, error, warning)
- `playwright-cli network` — list network requests
- `playwright-cli eval <js>` — run JavaScript on the page
- `playwright-cli reload` — reload current page

### Session management

- `playwright-cli list` — list all open browser sessions
- `playwright-cli close-all` — close all browser sessions
- `playwright-cli kill-all` — force kill zombie sessions

### Multi-browser testing workflow

1. Open Chrome and WebKit sessions with `-s=` and `PLAYWRIGHT_MCP_BROWSER=webkit`
2. Use `snapshot` to get element refs (refs change between snapshots — always re-snapshot before clicking)
3. Use `screenshot` + `Read` to see visual state (overlays, modals not visible in accessibility tree)
4. Use `console info` to capture diagnostic logs from each browser
5. For mic/camera permissions: user must manually click "Allow" on the browser popup

## Test Users

- **testcaller**: testcaller@example.com, password: test1234, ID: cbf87bec-44e4-46a2-b1f7-2b706984c0b9
- **testuser_debug** (testavatar2): testavatar2@example.com, password in macOS Keychain (`forum-chat-voice-test-user`), ID: 47db5208-fef0-4554-a937-250b700d0142
- DM conversation between testcaller and testuser_debug: 17eefb2d-c5f0-4c04-bf65-e5233a1592d8

## Cloudflare Tunnel Ingress

All services self-hosted on Proxmox LXCs, routed via Cloudflare Tunnel. Proxmox host: 192.168.1.98 (john@).

| Hostname | LXC | IP | CT ID | SSH hostname |
|----------|-----|----|-------|--------------|
| demo.forumline.net | forum-prod | 192.168.1.23 | 100 | ssh.forumline.net |
| app.forumline.net | forumline-prod | 192.168.1.99 | 101 | app-ssh.forumline.net |
| forum-b.forumline.net | forum-b-prod | 192.168.1.105 | 102 | forum-b-ssh.forumline.net |
| forumline.net | website-prod | 192.168.1.106 | 103 | www-ssh.forumline.net |
| hosted.forumline.net / *.forumline.net | hosted-prod | 192.168.1.107 | 104 | hosted-ssh.forumline.net |

All services listen on port 3000. Cloudflare Tunnel ID: b00696cc-c867-42d0-8649-6367b96abd64.

## Website (forumline.net)

- **URL**: https://forumline.net
- **Remote path**: `/opt/website/` (docker-compose.yml, repo)
- **Dockerfile**: `docker/Dockerfile.website` (nginx serving static files)
- **Content**: `website/` directory — static HTML/CSS, neocities aesthetic

## Forumline Web App

- **URL**: https://app.forumline.net
- **Remote path**: `/opt/forumline/` (docker-compose.yml, .env, postgres-data, repo)
- **Database tables**: forumline_profiles, forumline_forums, forumline_memberships, forumline_oauth_clients, forumline_auth_codes, forumline_direct_messages, push_subscriptions
- **Auto-confirm enabled**: Users can sign up without email verification
- **Seed forum**: demo.forumline.net (ID: 1c529bf0-e59c-419d-9589-c38eae9512df, approved: true)
- **Forum OAuth client_id**: 3be68164458706c758221650505697f2
- **Forum OAuth client_secret**: stored in forum .env.local as FORUMLINE_CLIENT_SECRET

## Forum-A (Basic Example Forum)

- **URL**: https://demo.forumline.net
- **Remote path**: `/opt/forum/` (docker-compose.yml, .env, postgres-data, repo)
- **Health check**: `/opt/forum/health-check.sh` runs every 5 min via cron, alerts via Resend email
- **Avatar storage**: Cloudflare R2 bucket `forumline-avatars`, public URL: `https://pub-9fedbeec44784c27aa252b7360d67971.r2.dev`
- **R2 credentials**: Keychain `cloudflare-r2-access-key-id` and `cloudflare-r2-secret-access-key`

## Forum-B (Gothic Example Forum)

- **URL**: https://forum-b.forumline.net
- **Remote path**: `/opt/forum-b/` (docker-compose.yml, .env, repo)
- **Dockerfile**: `docker/Dockerfile.go-forum-b`
- **Frontend**: `example-forum-instances-and-shared-forum-server/forum-b/` — gothic/neocities theme, vanilla JS + Vite
- **Vite dev port**: 5175
- **OAuth client_id**: f5fd7cf2cae68b6fe067c2a18f5f5367

## iOS App

- **Bundle ID**: net.forumline.app
- **Min deployment target**: iOS 16.0
- **Project generation**: XcodeGen (`project.yml`)
- **Architecture**: WKWebView wrapper loading app.forumline.net, with native bridges for:
  - Push notifications (APNs + PushKit VoIP)
  - CallKit integration (`CallManager.swift`)
  - WebView ↔ native JS bridge (`WebViewBridge.swift`)
- **Background modes**: VoIP, remote notifications, audio
- **Source**: `native-applications/ios/`
- **Simulator testing** (via `ios_webkit_debug_proxy` + `websocat`):
  - **Setup**: Find socket with `lsof -aUc launchd_sim | grep webinspectord`, then `ios_webkit_debug_proxy -s unix:<socket_path> &`
  - **Execute JS**: `native-applications/ios/sim-js.sh 'document.title'` — runs arbitrary JS in the running WKWebView
  - **Read page**: `sim-js.sh 'document.body.innerText'` — get visible text content
  - **Click elements**: `sim-js.sh "document.querySelector('button').click()"`
  - **List elements**: `sim-js.sh "Array.from(document.querySelectorAll('a,button')).map(e=>e.textContent.trim()+'|'+e.tagName).join('\n')"`
  - **Screenshot**: `xcrun simctl io booted screenshot /tmp/screenshot.png`
  - **Login**: `sim-js.sh "var s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; var e=document.querySelector('input[type=email]'); var p=document.querySelector('input[type=password]'); s.call(e,'EMAIL'); e.dispatchEvent(new Event('input',{bubbles:true})); s.call(p,'PASS'); p.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); 'done'"`
  - **Requires**: `brew install ios-webkit-debug-proxy websocat`, app must have `isInspectable = true` (already set)
- **Build & run on simulator**:
  - `cd native-applications/ios && xcodebuild -project Forumline.xcodeproj -scheme Forumline -sdk iphonesimulator -destination 'id=<DEVICE_ID>' build`
  - `xcrun simctl install booted <path-to-DerivedData>/Build/Products/Debug-iphonesimulator/Forumline.app`
  - `xcrun simctl launch booted net.forumline.app`

## Android App

- **Package**: net.forumline.app
- **Min SDK**: 26 (Android 8.0)
- **Architecture**: WebView wrapper loading app.forumline.net, with native bridges for:
  - Push notifications (Firebase Cloud Messaging)
  - Telecom ConnectionService for native call UI (`CallConnectionService.kt`)
  - WebView ↔ native JS bridge (`WebViewBridge.kt`)
- **Source**: `native-applications/android/`
- **JS bridge**: Same interface as iOS — `window.forumlineNative.postMessage()` / `window.forumlineNativeBridge.onMessage()`
  - Android uses `window.__FORUMLINE_ANDROID__` (iOS uses `window.__FORUMLINE_IOS__`)
- **FCM setup**: Requires `google-services.json` from Firebase Console (gitignored)
- **Build**: Open in Android Studio or `./gradlew assembleDebug`
- **Emulator local dev**: Change URL to `http://10.0.2.2:3001` in `MainActivity.kt`

## Hosted Forum Server (Multi-Tenant)

- **URL**: https://hosted.forumline.net (platform API) + *.forumline.net (hosted forums)
- **Remote path**: `/opt/hosted/` (docker-compose.yml, .env, repo)
- **Dockerfile**: `docker/Dockerfile.go-hosted` (hosted Go binary, forum-a frontend as default template)
- **Auth**: Forumline identity only (no GoTrue), JWTs signed with FORUMLINE_JWT_SECRET
- **Database**: Postgres with schema-per-tenant isolation, platform_tenants table in public schema
- **Wildcard routing**: *.forumline.net catch-all routes unmatched subdomains to hosted server

## Deployment

- All deploy via GitHub Actions → SSH via cloudflared → git pull + docker compose rebuild
- Multi-stage Dockerfiles in `docker/`: `Dockerfile.go-forum`, `Dockerfile.go-forum-b`, `Dockerfile.go-forumline`, `Dockerfile.go-hosted`, `Dockerfile.website`
- Deploy workflows: `.github/workflows/deploy-{forum,forum-b,forumline,website,hosted}.yml`
- Total hosting cost: $0/mo (all self-hosted on Proxmox)

## Package Manager

- **pnpm** with `pnpm-workspace.yaml` at root
- Workspace deps use `workspace:*` specifier
- `example-forum-instances-and-shared-forum-server/forum-a/` is standalone (not in workspace) — use `pnpm install --ignore-workspace` there
- Dockerfiles use `corepack enable && corepack prepare pnpm@10.6.5 --activate`
- GitHub Packages: `@johnvondrashek` scope, registry in `.npmrc`, `GITHUB_PACKAGES_TOKEN` needed for install

## Email / SMTP

- **Provider**: Resend (smtp.resend.com:465)
- **API key**: macOS Keychain under `resend-api-key`
- **Sender**: noreply@forumline.net (domain verified in Cloudflare DNS)

## Local Dev & Testing

- **Local stack**: `forumline-identity-and-federation-api/docker-compose.yml` runs Postgres (:5433) + GoTrue (:9999)
- **Go forum server**: `cd example-forum-instances-and-shared-forum-server && export $(grep -v '^#' .env.local | xargs) && go run ./forum-a/` (port 3000)
- **Forumline app (Docker, OrbStack)**: Build and run the full Forumline web app + API locally:
  1. Start the DB stack: `cd forumline-identity-and-federation-api && docker compose up -d`
  2. Build the image: `GITHUB_PACKAGES_TOKEN=dummy docker compose build forumline` (token not needed — workspace packages resolve locally)
  3. Run the container:
     ```
     docker run -d --name forumline-local -p 3001:3000 \
       -e DATABASE_URL="postgres://postgres:postgres@host.docker.internal:5433/postgres?sslmode=disable" \
       -e GOTRUE_URL="http://host.docker.internal:9999" \
       -e JWT_SECRET="super-secret-jwt-token-for-local-dev-min-32-chars" \
       -e FORUMLINE_JWT_SECRET="forumline-secret-for-identity-tokens-local-dev-32ch" \
       -e PORT=3000 -e CORS_ALLOWED_ORIGINS="*" \
       -e LIVEKIT_URL="wss://forum-9rmr0mb0.livekit.cloud" \
       -e LIVEKIT_API_KEY="APIFq5iPXz6KiKV" \
       -e LIVEKIT_API_SECRET="mchrjJjSVKPfoP8uJNeqMTeiG5bffnnsyJoBsWr1yoSD" \
       -e VAPID_PUBLIC_KEY="local-dev-vapid-public" \
       -e VAPID_PRIVATE_KEY="local-dev-vapid-private" \
       -e VAPID_EMAIL="dev@localhost" \
       forumline-forumline
     ```
  4. App available at http://localhost:3001
  5. Cleanup: `docker rm -f forumline-local`
- **iOS app local testing**: To point the iOS app at the local Docker container:
  1. In `WebViewContainer.swift`, change the URL to `http://localhost:3001`
  2. Add ATS exception to `Info.plist` (inside the top-level `<dict>`):
     ```xml
     <key>NSAppTransportSecurity</key>
     <dict>
       <key>NSExceptionDomains</key>
       <dict>
         <key>localhost</key>
         <dict>
           <key>NSExceptionAllowsInsecureHTTPLoads</key>
           <true/>
         </dict>
       </dict>
     </dict>
     ```
  3. Rebuild and install on simulator
  4. **Revert both changes before committing** — production URL is `https://app.forumline.net`
- **Lefthook**: Git hooks auto-install via `pnpm install` (postinstall). Pre-commit runs ESLint, golangci-lint, Go tests, and TS tests in parallel. CI runs the same `lefthook.yml` config via `npx lefthook run pre-commit --all-files`. Single source of truth for both local and CI checks.
- **ALWAYS test locally before pushing**

## Key Architecture

- Self-hosted GoTrue for auth (no Supabase dependency)
- Self-hosted Postgres 17 (LISTEN/NOTIFY for SSE realtime)
- Cloudflare R2 for avatar/image storage
- Forum frontend: vanilla JS + Vite + TailwindCSS
- Forumline app frontend: vanilla TS + Vite + VanJS
- Go API servers (Chi router)
- LiveKit for voice rooms
- DiceBear avatars: `avataaars` style for users, `shapes` style for threads, seeded by ID
- Layered package architecture: protocol types → server-sdk
- API relative imports MUST use `.js` extensions (Node.js ESM resolution requirement)
- Naming uses `forumline_` prefix everywhere (DB tables, cookies, env vars, Go packages, TS types)
