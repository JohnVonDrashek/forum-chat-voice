# Forumline Architecture Diagrams

## 1. High-Level System Overview

```mermaid
graph TB
    subgraph Clients
        Browser[Browser]
        iOS[iOS App<br/>WKWebView]
        Android[Android App<br/>WebView]
        macOS[macOS App<br/>WKWebView]
        Homebrew[Desktop<br/>Homebrew Cask]
    end

    subgraph Cloudflare
        Tunnel[Cloudflare Tunnel]
        R2[Cloudflare R2<br/>Avatars + Custom Sites]
        Workers[Status Redirect Worker]
        Uptimer[Uptimer<br/>Workers + D1]
    end

    subgraph Proxmox["Proxmox Host (192.168.1.98)"]
        subgraph CT100["CT 100 — forum-prod (192.168.1.23)"]
            Forum[Forum Server<br/>Go + Chi v5<br/>:3000]
            ForumFE[Forum Frontend<br/>Vanilla JS + Vite + Tailwind]
            ForumDB[(Postgres 17)]
            Alloy1[Alloy Agent]
        end

        subgraph CT101["CT 101 — forumline-prod (192.168.1.99)"]
            API[Forumline API<br/>Go stdlib ServeMux<br/>:3000]
            SPA[Forumline SPA<br/>Vanilla JS + Vite<br/>served from ./dist]
            GoTrue[GoTrue v2.186.0<br/>:9999]
            AppDB[(Postgres 17)]
            Alloy2[Alloy Agent]
        end

        subgraph CT103["CT 103 — website-prod (192.168.1.106)"]
            Website[Static Website<br/>Nginx<br/>:3000]
            Alloy3[Alloy Agent]
        end

        subgraph CT104["CT 104 — hosted-prod (192.168.1.107)"]
            Hosted[Hosted Server<br/>Go + Chi v5<br/>:3000]
            Citus[(Citus 13.0<br/>Schema-per-tenant)]
            Alloy4[Alloy Agent]
        end

        subgraph CT105["CT 105 — logs-prod (192.168.1.108)"]
            VLogs[VictoriaLogs<br/>:9428<br/>30-day retention]
        end

        WG[WireGuard VPN<br/>10.10.0.0/24<br/>:51820]
    end

    LiveKit[LiveKit Cloud<br/>Voice Rooms<br/>forum only]
    Resend[Resend SMTP<br/>noreply@forumline.net]
    DiceBear[DiceBear API<br/>Deterministic Avatars]
    Developer[Developer Laptop<br/>VPN Client]

    Clients --> Tunnel
    Tunnel -->|demo.forumline.net| Forum
    Tunnel -->|app.forumline.net| API
    Tunnel -->|forumline.net| Website
    Tunnel -->|*.forumline.net| Hosted
    Tunnel -->|ssh.forumline.net<br/>CI only| Proxmox

    Developer -->|WireGuard VPN| WG
    WG -.->|direct access| VLogs

    Forum --> ForumDB
    Forum --> R2
    Forum --> LiveKit
    API --> AppDB
    API --> GoTrue
    API --> R2
    API --> Resend
    Hosted --> Citus
    Hosted --> R2

    Alloy1 -->|Loki push| VLogs
    Alloy2 -->|Loki push| VLogs
    Alloy3 -->|Loki push| VLogs
    Alloy4 -->|Loki push| VLogs

    Workers -.->|proxy when healthy<br/>redirect when down| Tunnel
    Uptimer -.->|health checks 60s| Tunnel
```

## 2. Application Architecture — Forumline App

```mermaid
graph TB
    subgraph Browser["Browser / WebView"]
        SPA["Vanilla JS SPA<br/>~7K LOC, zero deps<br/>Direct DOM manipulation"]
        Router["Client Router<br/>History API + popState"]
        SSEClient["SSE Clients<br/>DM stream, Call stream,<br/>Notification stream"]
        WebRTC["WebRTC P2P<br/>1:1 Voice Calls"]
        SW["Service Worker<br/>Push + Deep Links"]
        IFrame["Forum iframes<br/>postMessage bridge"]
    end

    subgraph GoAPI["Go API (stdlib ServeMux)"]
        subgraph Middleware
            CORS[CORS]
            SecHeaders[Security Headers]
            RateLimit["Rate Limiters<br/>auth: 10/min<br/>signup: 5/min<br/>DMs: 30/min"]
            Auth["Auth Middleware<br/>JWT from Bearer / Cookie"]
        end

        subgraph Handlers["Handlers (12 files)"]
            AuthH[Auth Handler<br/>login, signup, logout]
            OAuthH[OAuth Handler<br/>authorize, token]
            ConvH[Conversation Handler<br/>DMs, groups, stream]
            CallH[Call Handler<br/>initiate, respond, signal]
            ForumH[Forum Handler<br/>discovery, registration]
            NotifH[Notification Handler<br/>stream, mark read]
            PushH[Push Handler<br/>subscribe, notify]
            PresH[Presence Handler<br/>heartbeat, status]
            WebhookH[Webhook Handler<br/>forum notifications]
        end

        subgraph Services["Service Layer"]
            ConvSvc[ConversationService]
            CallSvc[CallService]
            ForumSvc[ForumService]
            PushSvc[PushService]
            RegSvc[RegistrationService]
        end

        subgraph Store["Store Layer (pgx)"]
            ProfileStore[profile.go]
            ConvStore[conversation.go]
            CallStore[call.go]
            ForumStore[forum.go]
            OAuthStore[oauth.go]
            NotifStore[notification.go]
            PushStore[push.go]
        end

        SSEHub["SSE Hub<br/>Single PG LISTEN conn<br/>Multiplexes to N clients"]
        PushListener["Push Listener<br/>Background goroutine<br/>webpush-go + VAPID"]
    end

    subgraph GoTrueBox["GoTrue v2.186.0"]
        GTAuth["Email/Password Auth<br/>JWT issuance<br/>Token refresh"]
    end

    subgraph Postgres["Postgres 17"]
        AuthSchema["auth schema<br/>(GoTrue managed)"]
        AppTables["forumline_profiles<br/>forumline_forums<br/>forumline_memberships<br/>forumline_conversations<br/>forumline_direct_messages<br/>forumline_calls<br/>forumline_notifications<br/>forumline_oauth_clients<br/>push_subscriptions"]
        Triggers["DB Triggers<br/>NOTIFY dm_changes<br/>NOTIFY push_dm<br/>NOTIFY call_signal<br/>NOTIFY forumline_notification_changes"]
    end

    SPA --> GoAPI
    SSEClient --> SSEHub
    WebRTC -->|signaling via SSE| CallH
    IFrame -->|postMessage| SPA
    SW -->|push events| Browser

    Handlers --> Services
    Services --> Store
    Store --> Postgres
    AuthH --> GoTrueBox
    SSEHub -->|LISTEN| Triggers
    PushListener -->|LISTEN push_dm| Triggers

    GoTrueBox --> AuthSchema
```

## 3. Application Architecture — Forum Server

```mermaid
graph TB
    subgraph ForumFrontend["Forum Frontend (Vanilla JS + Vite + Tailwind)"]
        FRouter["Client Router<br/>Regex-based SPA routing"]
        FPages["Pages: Home, Thread, Chat,<br/>Voice, Profile, Search,<br/>Bookmarks, Settings, Admin"]
        FSSE["SSE Streams<br/>posts, chat, voice presence,<br/>notifications"]
        FLiveKit["LiveKit SDK<br/>Voice Rooms"]
        FIFrame["iframe postMessage<br/>forumline:ready<br/>forumline:auth_state"]
    end

    subgraph ForumGo["Go API (Chi v5, no GoTrue)"]
        subgraph FHandlers["Handlers"]
            ThreadH[Threads + Posts]
            ChatH[Chat Messages]
            VoiceH[Voice Rooms + Presence]
            ForumlineH["Forumline OAuth<br/>2 flows:<br/>server-side iframe, browser redirect"]
            BookmarkH[Bookmarks]
            NotifFH[Notifications]
            AvatarH["Avatar Upload<br/>SVG→R2"]
            AdminH[Admin Stats]
            ManifestH["/.well-known/<br/>forumline-manifest.json"]
        end

        subgraph FServices["Service Layer"]
            ThreadSvc[ThreadService]
            PostSvc[PostService]
            ChatSvc[ChatService]
            ProfileSvc[ProfileService]
            NotifSvc[NotificationService]
        end

        subgraph FStore["Store Layer"]
            FStoreFiles["threads, posts, profiles,<br/>chat, voice, bookmarks,<br/>notifications"]
        end

        FSSEHub["SSE Hub<br/>4 channels:<br/>notification_changes<br/>chat_message_changes<br/>voice_presence_changes<br/>post_changes"]
    end

    subgraph FDB["Postgres 17"]
        FTables["profiles, categories, threads,<br/>posts, chat_channels, chat_messages,<br/>voice_rooms, voice_presence,<br/>bookmarks, notifications,<br/>channel_follows, notification_preferences"]
        FTriggers["DB Triggers → pg_notify()"]
    end

    ForumFrontend --> ForumGo
    FHandlers --> FServices
    FServices --> FStore
    FStore --> FDB
    FSSEHub -->|LISTEN| FTriggers
    FSSE --> FSSEHub
    ForumlineH -->|OAuth code exchange| ForumlineAPI["Forumline API<br/>app.forumline.net"]
```

## 4. Hosted Multi-Tenant Architecture

```mermaid
graph TB
    subgraph Requests
        F1["forum1.forumline.net"]
        F2["forum2.forumline.net"]
        FN["forumN.forumline.net"]
    end

    subgraph HostedServer["Hosted Server (single Go process)"]
        TenantMW["Tenant Middleware<br/>Host header → TenantStore lookup"]
        TenantStore["TenantStore (in-memory)<br/>RWMutex, refreshes every 30s<br/>O(1) lookup by domain or slug"]
        RouterCache["Router Cache<br/>one cached handler per tenant"]
        TenantPool["TenantPool<br/>Shared pgxpool.Pool<br/>SET search_path per request"]

        subgraph PlatformAPI["Platform API (no tenant context)"]
            Provision["POST /api/platform/forums<br/>→ CREATE SCHEMA<br/>→ Load template tables<br/>→ Register with Forumline<br/>→ citus_schema_distribute()"]
            ListForums["GET /api/platform/forums"]
            Export["GET /api/platform/forums/{slug}/export"]
            SiteAPI["Site Management API<br/>Upload custom SPA to R2<br/>5MB/file, 50MB/tenant"]
        end

        subgraph TenantRoutes["Tenant Routes (behind middleware)"]
            ForumRouter["Full Forum Router<br/>same handlers as forum-server"]
        end

        SiteCache["LRU Site Cache<br/>256MB, 5-min TTL"]
    end

    subgraph CitusDB["Citus 13.0 (Distributed Postgres)"]
        PublicSchema["public schema<br/>platform_tenants table"]
        Schema1["forum_forum1 schema<br/>profiles, threads, posts..."]
        Schema2["forum_forum2 schema<br/>profiles, threads, posts..."]
        SchemaN["forum_forumN schema<br/>profiles, threads, posts..."]
        CitusSharding["Schema-based sharding<br/>Add worker nodes = auto-distribute<br/>Zero code changes"]
    end

    R2Storage["Cloudflare R2<br/>sites/{slug}/files/*"]

    F1 --> TenantMW
    F2 --> TenantMW
    FN --> TenantMW
    TenantMW -->|lookup| TenantStore
    TenantMW -->|SET search_path| TenantPool
    TenantMW --> RouterCache
    RouterCache --> ForumRouter
    ForumRouter --> TenantPool
    TenantPool --> Schema1
    TenantPool --> Schema2
    TenantPool --> SchemaN

    PlatformAPI --> PublicSchema
    Provision --> CitusSharding

    SiteAPI --> R2Storage
    SiteCache --> R2Storage

    TenantStore -->|refresh| PublicSchema

    style CitusDB fill:#f0f0ff
    style PublicSchema fill:#ffe0e0
```

## 5. SSE Real-Time Architecture

```mermaid
graph LR
    subgraph Postgres
        Triggers["DB Triggers<br/>on INSERT/UPDATE/DELETE"]
        Channels["NOTIFY channels:<br/>dm_changes<br/>push_dm<br/>call_signal<br/>notification_changes<br/>chat_message_changes<br/>voice_presence_changes<br/>post_changes"]
    end

    subgraph SSEHub["SSE Hub (shared-go)"]
        Listener["Single PG Connection<br/>LISTEN on all channels<br/>Auto-reconnect on failure"]
        Broadcast["Broadcast Loop<br/>Parse JSON payload<br/>Match client filters"]
    end

    subgraph Clients["Connected SSE Clients"]
        C1["User A: DM stream<br/>filter: member_ids contains A"]
        C2["User A: Call stream<br/>filter: target_user_id = A"]
        C3["User B: DM stream<br/>filter: member_ids contains B"]
        C4["User C: Post stream<br/>filter: thread_id = 123"]
        C5["User D: Notification stream<br/>filter: user_id = D"]
    end

    subgraph PushPath["Push Notification Path"]
        PushListener["Push Listener<br/>Listens on push_dm channel"]
        WebPush["webpush-go<br/>VAPID signed"]
        APNs["APNs"]
        FCM["FCM"]
    end

    Triggers --> Channels
    Channels --> Listener
    Listener --> Broadcast
    Broadcast -->|filtered| C1
    Broadcast -->|filtered| C2
    Broadcast -->|filtered| C3
    Broadcast -->|filtered| C4
    Broadcast -->|filtered| C5

    Channels --> PushListener
    PushListener --> WebPush
    PushListener --> APNs
    PushListener --> FCM

    style SSEHub fill:#fff3e0
```

## 6. Federation Protocol — Forum Discovery & OAuth

```mermaid
sequenceDiagram
    participant ForumOp as Forum Operator
    participant Forum as Forum Server
    participant App as Forumline App<br/>(app.forumline.net)
    participant User as User Browser

    rect rgb(240, 248, 255)
        Note over ForumOp, App: Forum Registration
        ForumOp->>App: POST /api/forums/register<br/>{domain, name, manifest_url}
        App->>Forum: GET /.well-known/forumline-manifest.json
        Forum-->>App: {name, capabilities, api_base, web_base}
        App->>App: Validate domain, store forum record
        App->>App: Generate OAuth client_id + client_secret
        App-->>ForumOp: {client_id, client_secret}
        ForumOp->>Forum: Store credentials in .env
    end

    rect rgb(240, 255, 240)
        Note over Forum, User: User Signs In (Forumline Identity Only)
        User->>Forum: Click "Sign in with Forumline"
        Forum->>App: Redirect to /oauth/authorize?client_id=X
        App->>App: User authenticates (GoTrue on Forumline side)
        App-->>Forum: Redirect to callback with auth code
        Forum->>App: POST /api/oauth/token<br/>{code, client_id, client_secret}
        App-->>Forum: {identity_token (JWT), forumline_access_token}
        Forum->>Forum: Create/link local profile<br/>using forumline_id as PK
        Forum->>Forum: Sign session JWT with<br/>FORUMLINE_JWT_SECRET
        Forum-->>User: Redirect with access_token in hash
    end

    rect rgb(255, 248, 240)
        Note over Forum, App: Cross-Forum Notifications
        Forum->>App: POST /api/webhooks/notifications<br/>{user_id, type, title, body, link}
        App->>App: Check mute status
        App->>App: Insert forumline_notifications
        App-->>User: SSE notification_changes event
        App-->>User: Web Push / APNs / FCM
    end
```

## 7. Monorepo Structure & Build Pipeline

```mermaid
graph TB
    subgraph Packages["Shared Packages"]
        Proto["@forumline/protocol<br/>Federation types (TS + Zod)<br/>manifest, identity, notifications,<br/>webview messages, DMs, validation"]
        SDK["@forumline/server-sdk<br/>ForumlineServer class<br/>OAuth flow handlers<br/>SSE notification helpers<br/>Rate limiting, cookie utils"]
        SharedGo["shared-go<br/>SSEHub, AuthMiddleware,<br/>CORS, RateLimit, DB pool,<br/>ObservablePool, JWT validation"]
    end

    subgraph Services
        ForumSvc["services/forum<br/>Go (Chi v5) + Vanilla JS<br/>Standalone forum server"]
        APISvc["services/forumline-api<br/>Go (stdlib ServeMux)<br/>Central platform API"]
        WebSvc["services/forumline-web<br/>Vanilla JS SPA<br/>~7K LOC, zero npm deps"]
        HostedSvc["services/hosted<br/>Go (Chi v5)<br/>Multi-tenant platform"]
        WebsiteSvc["services/website<br/>Static HTML/CSS<br/>Neocities aesthetic"]
    end

    subgraph Apps
        iOSApp["apps/ios<br/>WKWebView + CallKit<br/>APNs + PushKit VoIP"]
        AndroidApp["apps/android<br/>WebView + ConnectionService<br/>Firebase Cloud Messaging"]
        macOSApp["apps/macos<br/>WKWebView wrapper"]
    end

    subgraph Build["Docker Build (multi-stage)"]
        D1["Dockerfile.go-forumline<br/>1. Go build forumline-api<br/>2. Vite build forumline-web<br/>3. Alpine + binary + dist/"]
        D2["Dockerfile.go-forum<br/>1. Go build forum<br/>2. Vite build forum frontend<br/>3. Alpine + binary + dist/"]
        D3["Dockerfile.go-hosted<br/>1. Go build hosted<br/>2. Forum frontend as default template<br/>3. Alpine + binary + dist/"]
        D4["Dockerfile.website<br/>nginx:alpine + static files"]
    end

    Proto --> SDK
    Proto -.->|types| WebSvc
    SharedGo --> ForumSvc
    SharedGo --> APISvc
    SharedGo --> HostedSvc

    WebSvc -->|vite build → dist/| APISvc
    ForumSvc -->|frontend reused as template| HostedSvc

    APISvc --> D1
    ForumSvc --> D2
    HostedSvc --> D3
    WebsiteSvc --> D4

    iOSApp -->|loads| WebSvc
    AndroidApp -->|loads| WebSvc
    macOSApp -->|loads| WebSvc

    subgraph SplitRepo["Public Distribution"]
        Splitsh["splitsh-lite<br/>Extract services/forum subtree"]
        PublicRepo["github.com/forumline/forum-server<br/>Read-only public repo"]
        SharedGoTag["shared-go tagged release<br/>go.mod rewritten to use tag"]
    end

    ForumSvc --> Splitsh
    SharedGo -->|tag + publish| SharedGoTag
    Splitsh --> PublicRepo
```

## 8. Deploy Pipeline

```mermaid
graph TB
    subgraph Dev["Developer"]
        Push["git push main"]
    end

    subgraph GHA["GitHub Actions (path-triggered)"]
        Lint["lint.yml<br/>pnpm install + lefthook<br/>ESLint, golangci-lint,<br/>Go tests, TS tests"]

        DeployFL["deploy-forumline.yml<br/>Trigger: services/forumline-*,<br/>packages/*, deploy/docker/"]
        DeployForum["deploy-forum.yml<br/>via split-repos.yml"]
        DeployHosted["deploy-hosted.yml<br/>Trigger: services/hosted/*"]
        DeployWeb["deploy-website.yml<br/>Trigger: services/website/*"]
        DeployLogs["deploy-logs.yml<br/>deploy-logs-agents.yml"]

        SplitRepos["split-repos.yml<br/>Tag shared-go, splitsh-lite,<br/>rewrite go.mod, force-push"]
        Publish["publish-packages.yml<br/>→ GitHub Packages"]
        TFPlan["terraform-plan.yml<br/>OpenTofu plan on PR"]
        DesktopRelease["build-desktop-release.yml<br/>Sign, notarize, DMG,<br/>update homebrew-tap"]
    end

    subgraph DeploySteps["Deploy Steps (per service)"]
        Decrypt["SOPS decrypt .env.enc<br/>(age key from GH secret)"]
        SCP["SCP compose + env files"]
        SSH["SSH via cloudflared<br/>(Zero Trust service token)"]
        GitPull["git fetch + reset --hard"]
        Migrate["Run DB migrations"]
        Compose["docker compose up -d --build"]
    end

    subgraph Terraform["Infrastructure (OpenTofu)"]
        TunnelConfig["Cloudflare Tunnel routing<br/>hostname → LXC IP rules"]
        SSHBastion["Single SSH bastion<br/>ssh.forumline.net → Proxmox<br/>CI service token only"]
        TFState["State: R2 bucket<br/>Client-side AES-GCM encryption"]
        WireGuardTF["Developer access:<br/>WireGuard VPN on Proxmox"]
    end

    Push --> Lint
    Push --> DeployFL
    Push --> DeployHosted
    Push --> DeployWeb
    Push --> DeployLogs
    Push --> SplitRepos
    Push --> Publish

    DeployFL --> Decrypt --> SCP --> SSH --> GitPull --> Migrate --> Compose
    SplitRepos --> DeployForum

    TFPlan --> Terraform
```

## 9. Voice & Calls Architecture

```mermaid
graph TB
    subgraph ForumVoice["Forum Voice Rooms (LiveKit)"]
        VoiceUI["Voice Room UI<br/>Join/Leave, Mute, Speaking indicator"]
        LKClient["LiveKit Client SDK"]
        LKServer["LiveKit Cloud<br/>(managed SFU)"]
        VoicePresence["voice_presence table<br/>Track who's in which room"]
        VoiceSSE["SSE: voice_presence_changes<br/>Real-time join/leave updates"]
    end

    subgraph AppCalls["Forumline 1:1 Calls (WebRTC P2P)"]
        CallUI["Call UI<br/>Incoming overlay + Active bar"]
        PeerConn["RTCPeerConnection<br/>STUN: stun.l.google.com:19302"]
        CallSignaling["Signaling via SSE<br/>call_signal channel<br/>offer/answer/ICE candidates"]
        CallStore["forumline_calls table<br/>States: ringing → active → completed<br/>or: ringing → declined/missed"]
        Ringtone["Web Audio API<br/>440 Hz sine wave ringtone"]
    end

    subgraph NativeCalls["Native Call Integration"]
        CallKit["iOS CallKit<br/>Native incoming call UI"]
        PushKit["PushKit VoIP<br/>Wake app for incoming calls"]
        ConnSvc["Android ConnectionService<br/>Native call management"]
        FCMCall["FCM High Priority<br/>Wake app for incoming calls"]
    end

    VoiceUI --> LKClient
    LKClient <-->|WebRTC SFU| LKServer
    VoiceUI --> VoicePresence
    VoicePresence --> VoiceSSE

    CallUI --> PeerConn
    PeerConn <-->|P2P audio| PeerConn
    CallSignaling --> CallStore

    CallKit --> CallUI
    PushKit --> CallKit
    ConnSvc --> CallUI
    FCMCall --> ConnSvc
```

## 10. Native App Bridge Architecture

```mermaid
graph TB
    subgraph WebApp["Forumline Web App (in WebView)"]
        JS["Vanilla JS SPA"]
        NativeBridge["native-bridge.js<br/>Detects platform:<br/>__FORUMLINE_IOS__<br/>__FORUMLINE_ANDROID__"]
        PostMsg["window.forumlineNative.postMessage()"]
        OnMsg["window.forumlineNativeBridge.onMessage()"]
    end

    subgraph iOS["iOS Native (Swift)"]
        WKWebView["WKWebView<br/>isInspectable = true"]
        WKBridge["WebViewBridge.swift<br/>WKScriptMessageHandler"]
        CallManager["CallManager.swift<br/>CXProvider + CXCallController"]
        CKCallKit["CallKit Framework<br/>Native incoming/active call UI"]
        APNsPush["APNs Push<br/>Standard + PushKit VoIP"]
        IOSAB["Background Modes:<br/>VoIP, remote-notifications, audio"]
    end

    subgraph Android["Android Native (Kotlin)"]
        AndroidWV["Android WebView"]
        KotlinBridge["WebViewBridge.kt<br/>@JavascriptInterface"]
        CallConn["CallConnectionService.kt<br/>Telecom ConnectionService"]
        FCMPush["Firebase Cloud Messaging"]
        AndroidBG["Foreground Service<br/>for active calls"]
    end

    subgraph Messages["Bridge Messages"]
        ToNative["To Native:<br/>push_token_register<br/>call_incoming<br/>call_active<br/>call_ended<br/>haptic_feedback"]
        FromNative["From Native:<br/>push_token<br/>call_answer<br/>call_decline<br/>call_end<br/>app_became_active"]
    end

    JS --> NativeBridge
    NativeBridge --> PostMsg
    OnMsg --> JS

    PostMsg -->|iOS| WKBridge
    WKBridge --> CallManager --> CKCallKit
    WKBridge --> APNsPush

    PostMsg -->|Android| KotlinBridge
    KotlinBridge --> CallConn
    KotlinBridge --> FCMPush

    ToNative -.-> PostMsg
    FromNative -.-> OnMsg
```

## 11. Database Schema Overview

```mermaid
erDiagram
    FORUMLINE_PROFILES {
        uuid id PK
        text username
        text display_name
        text avatar_url
        text bio
        timestamptz created_at
    }

    FORUMLINE_FORUMS {
        uuid id PK
        text domain
        text name
        text icon_url
        uuid owner_id FK
        int member_count
        text[] tags
        bool approved
    }

    FORUMLINE_MEMBERSHIPS {
        uuid id PK
        uuid user_id FK
        uuid forum_id FK
        bool muted
        timestamptz joined_at
    }

    FORUMLINE_CONVERSATIONS {
        uuid id PK
        text type
        timestamptz created_at
    }

    FORUMLINE_CONVERSATION_MEMBERS {
        uuid id PK
        uuid conversation_id FK
        uuid user_id FK
        timestamptz last_read_at
    }

    FORUMLINE_DIRECT_MESSAGES {
        uuid id PK
        uuid conversation_id FK
        uuid sender_id FK
        text content
        timestamptz created_at
    }

    FORUMLINE_CALLS {
        uuid id PK
        uuid caller_id FK
        uuid callee_id FK
        text status
        timestamptz started_at
        int duration
    }

    FORUMLINE_OAUTH_CLIENTS {
        uuid id PK
        uuid forum_id FK
        text client_id
        text client_secret_hash
    }

    FORUMLINE_NOTIFICATIONS {
        uuid id PK
        uuid user_id FK
        text type
        text title
        text message
        text link
        text forum_domain
        bool read
    }

    PUSH_SUBSCRIPTIONS {
        uuid id PK
        uuid user_id FK
        text endpoint
        text p256dh
        text auth
    }

    FORUMLINE_PROFILES ||--o{ FORUMLINE_MEMBERSHIPS : "joins forums"
    FORUMLINE_FORUMS ||--o{ FORUMLINE_MEMBERSHIPS : "has members"
    FORUMLINE_FORUMS ||--o| FORUMLINE_OAUTH_CLIENTS : "has credentials"
    FORUMLINE_PROFILES ||--o{ FORUMLINE_CONVERSATION_MEMBERS : "in conversations"
    FORUMLINE_CONVERSATIONS ||--o{ FORUMLINE_CONVERSATION_MEMBERS : "has members"
    FORUMLINE_CONVERSATIONS ||--o{ FORUMLINE_DIRECT_MESSAGES : "contains"
    FORUMLINE_PROFILES ||--o{ FORUMLINE_DIRECT_MESSAGES : "sends"
    FORUMLINE_PROFILES ||--o{ FORUMLINE_CALLS : "caller"
    FORUMLINE_PROFILES ||--o{ FORUMLINE_CALLS : "callee"
    FORUMLINE_PROFILES ||--o{ FORUMLINE_NOTIFICATIONS : "receives"
    FORUMLINE_PROFILES ||--o{ PUSH_SUBSCRIPTIONS : "has devices"
```

## 12. Logging & Observability

```mermaid
graph LR
    subgraph ServiceLXCs["Service LXCs (4 hosts, 17 containers)"]
        subgraph ForumProd["forum-prod"]
            FDocker["Docker containers"]
            FA["Alloy v1.14.0<br/>host=forum-prod"]
        end
        subgraph ForumlineProd["forumline-prod"]
            FLDocker["Docker containers"]
            FLA["Alloy v1.14.0<br/>host=forumline-prod"]
        end
        subgraph WebsiteProd["website-prod"]
            WDocker["Docker containers"]
            WA["Alloy v1.14.0<br/>host=website-prod"]
        end
        subgraph HostedProd["hosted-prod"]
            HDocker["Docker containers"]
            HA["Alloy v1.14.0<br/>host=hosted-prod"]
        end
    end

    subgraph LogsLXC["logs-prod (192.168.1.108)"]
        VL["VictoriaLogs<br/>:9428<br/>30-day retention<br/>LogsQL query engine"]
        VMUI["vmui<br/>Built-in web UI"]
    end

    subgraph Access["Query Access (VPN only)"]
        WebUI["Browser<br/>http://192.168.1.108:9428"]
        CLI["vlogscli<br/>Interactive LogsQL"]
        CURL["curl API<br/>/select/logsql/query"]
    end

    FDocker -->|Docker socket| FA
    FLDocker -->|Docker socket| FLA
    WDocker -->|Docker socket| WA
    HDocker -->|Docker socket| HA

    FA -->|Loki push :9428| VL
    FLA -->|Loki push :9428| VL
    WA -->|Loki push :9428| VL
    HA -->|Loki push :9428| VL

    VL --> VMUI

    WebUI -->|WireGuard VPN| VL
    CLI -->|WireGuard VPN| VL
    CURL -->|WireGuard VPN| VL

    style VL fill:#e8f5e9
```
