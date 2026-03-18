/**
 * @module auth
 *
 * OIDC Authorization Code + PKCE authentication against Zitadel.
 * Manages the full login lifecycle: sign-in/sign-up redirects, callback handling,
 * token storage in localStorage, and automatic background refresh.
 *
 * @example
 * ```ts
 * // Listen for auth changes
 * ForumlineAuth.onAuthStateChange((event, session) => {
 *   if (event === 'SIGNED_IN') console.log('Welcome!', session.user);
 * });
 *
 * // Kick off login
 * await ForumlineAuth.signIn();
 * ```
 */

declare const window: Window &
  typeof globalThis & {
    ZITADEL_URL?: string;
    ZITADEL_CLIENT_ID?: string;
  };

const ZITADEL_URL = window.ZITADEL_URL || 'https://auth.forumline.net';
const CLIENT_ID = window.ZITADEL_CLIENT_ID || '';
const REDIRECT_URI = window.location.origin + '/auth/callback';
const AUTH_STORAGE_KEY = 'forumline-session';

// --- PKCE Helpers (RFC 7636) ---

function _randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

function _base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function _generateCodeVerifier(): string {
  return _base64url(_randomBytes(32));
}

async function _generateCodeChallenge(verifier: string): Promise<string> {
  const encoded = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return _base64url(new Uint8Array(digest));
}

// --- OIDC Discovery (cached) ---

interface OIDCConfig {
  authorization_endpoint: string;
  token_endpoint: string;
  end_session_endpoint?: string;
  [key: string]: unknown;
}

let _oidcConfig: OIDCConfig | null = null;

async function _getOIDCConfig(): Promise<OIDCConfig> {
  if (_oidcConfig) return _oidcConfig;
  const res = await fetch(ZITADEL_URL + '/.well-known/openid-configuration');
  _oidcConfig = await res.json();
  return _oidcConfig!;
}

// --- Session Types ---

/** The authenticated user's profile extracted from the OIDC ID token. */
export interface SessionUser {
  /** Zitadel subject ID (globally unique). */
  id: string;
  /** User's email address. */
  email: string;
  user_metadata: {
    /** Unique username (from `preferred_username` claim). */
    username: string;
    /** Human-readable display name (from `given_name` + `family_name` claims). */
    display_name: string;
  };
}

/** An authenticated session with tokens and user info. */
export interface Session {
  /** OAuth2 access token (Bearer). */
  access_token: string;
  /** OAuth2 refresh token for background renewal. */
  refresh_token?: string;
  /** Token lifetime in seconds from time of issue. */
  expires_in: number;
  /** Absolute expiry as Unix timestamp (seconds). */
  expires_at: number;
  /** Decoded user profile from the ID token. */
  user: SessionUser;
}

/**
 * Auth event types emitted to {@link AuthCallback} listeners.
 * - `INITIAL_SESSION` — fired once on subscribe with the current session (or `null`).
 * - `SIGNED_IN` — user completed login via OIDC callback.
 * - `SIGNED_OUT` — session cleared (explicit logout or refresh failure).
 * - `TOKEN_REFRESHED` — access token renewed in the background.
 */
export type AuthEvent = 'INITIAL_SESSION' | 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED';

/** Callback signature for {@link ForumlineAuth.onAuthStateChange}. */
export type AuthCallback = (event: AuthEvent, session: Session | null) => void;

// --- Auth Module ---

/**
 * Singleton auth manager. Handles Zitadel OIDC PKCE login, token refresh,
 * and session persistence in localStorage. Auto-initializes on import.
 */
export const ForumlineAuth = {
  _listeners: new Set<AuthCallback>(),
  _refreshTimer: null as ReturnType<typeof setTimeout> | null,
  _currentSession: null as Session | null,
  _isRefreshing: false,

  _init() {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) {
      try {
        this._currentSession = JSON.parse(stored);
      } catch {
        localStorage.removeItem(AUTH_STORAGE_KEY);
      }
    }
    if (this._currentSession) {
      if (this._currentSession.expires_at * 1000 < Date.now()) {
        void this._refreshSession();
      } else {
        this._scheduleRefresh(this._currentSession);
      }
    }
  },

  _saveSession(session: Session | null) {
    this._currentSession = session;
    if (session) {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
      this._scheduleRefresh(session);
    } else {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      if (this._refreshTimer) {
        clearTimeout(this._refreshTimer);
        this._refreshTimer = null;
      }
    }
  },

  _scheduleRefresh(session: Session) {
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    const expiresAt = session.expires_at * 1000;
    const refreshIn = Math.max(expiresAt - Date.now() - 60000, 5000);
    this._refreshTimer = setTimeout(() => this._refreshSession(), refreshIn);
  },

  /** Whether a token refresh is currently in progress. */
  get isRefreshing(): boolean {
    return this._isRefreshing;
  },

  async _refreshSession(): Promise<boolean> {
    if (!this._currentSession?.refresh_token) return false;
    this._isRefreshing = true;
    try {
      const config = await _getOIDCConfig();
      const res = await fetch(config.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: CLIENT_ID,
          refresh_token: this._currentSession!.refresh_token!,
        }),
      });
      if (!res.ok) {
        console.error('[Auth] token refresh failed, signing out:', res.status);
        this._isRefreshing = false;
        this._saveSession(null);
        this._emit('SIGNED_OUT', null);
        return false;
      }
      const data = await res.json();
      const session = this._tokenResponseToSession(data);
      this._isRefreshing = false;
      this._saveSession(session);
      this._emit('TOKEN_REFRESHED', session);
      return true;
    } catch {
      this._isRefreshing = false;
      return false;
    }
  },

  _tokenResponseToSession(data: {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    id_token?: string;
  }): Session {
    const idPayload = data.id_token ? JSON.parse(atob(data.id_token.split('.')[1])) : {};
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in || 3600,
      expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
      user: {
        id: idPayload.sub || '',
        email: idPayload.email || '',
        user_metadata: {
          username: idPayload.preferred_username || '',
          display_name:
            [idPayload.given_name, idPayload.family_name].filter(Boolean).join(' ') ||
            idPayload.preferred_username ||
            '',
        },
      },
    };
  },

  _emit(event: AuthEvent, session: Session | null) {
    for (const cb of this._listeners) {
      try {
        cb(event, session);
      } catch (err) {
        console.error('[Forumline:Auth] listener error:', err);
      }
    }
  },

  /**
   * Redirect the user to Zitadel's hosted login page.
   * Uses OIDC Authorization Code flow with PKCE.
   * The browser will navigate away — call {@link handleCallback} on return.
   */
  async signIn(): Promise<void> {
    const verifier = _generateCodeVerifier();
    const challenge = await _generateCodeChallenge(verifier);
    sessionStorage.setItem('pkce_verifier', verifier);

    const config = await _getOIDCConfig();
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: 'openid profile email offline_access',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'login',
    });
    window.location.href = config.authorization_endpoint + '?' + params.toString();
  },

  /**
   * Redirect the user to Zitadel's registration page.
   * Same PKCE flow as {@link signIn} but with `prompt=create`.
   */
  async signUp(): Promise<void> {
    const verifier = _generateCodeVerifier();
    const challenge = await _generateCodeChallenge(verifier);
    sessionStorage.setItem('pkce_verifier', verifier);

    const config = await _getOIDCConfig();
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: 'openid profile email offline_access',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'create',
    });
    window.location.href = config.authorization_endpoint + '?' + params.toString();
  },

  /**
   * Handle the OIDC callback after Zitadel redirects back.
   * Exchanges the authorization code for tokens and stores the session.
   * @returns `true` if the callback was handled successfully, `false` otherwise.
   */
  async handleCallback(): Promise<boolean> {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (!code) return false;

    const verifier = sessionStorage.getItem('pkce_verifier');
    sessionStorage.removeItem('pkce_verifier');
    if (!verifier) return false;

    try {
      const config = await _getOIDCConfig();
      const res = await fetch(config.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: CLIENT_ID,
          code,
          redirect_uri: REDIRECT_URI,
          code_verifier: verifier,
        }),
      });
      if (!res.ok) {
        console.error('[Auth] login callback failed:', res.status);
        return false;
      }

      const data = await res.json();
      const session = this._tokenResponseToSession(data);
      this._saveSession(session);

      // Clean up URL
      window.history.replaceState({}, '', '/');
      this._emit('SIGNED_IN', session);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Sign out the current user. Clears local session and redirects to
   * Zitadel's end-session endpoint to clear the IdP session too.
   */
  async signOut(): Promise<void> {
    const session = this._currentSession;
    this._saveSession(null);
    this._emit('SIGNED_OUT', null);

    // Redirect to Zitadel's end_session endpoint
    try {
      const config = await _getOIDCConfig();
      if (config.end_session_endpoint && session?.access_token) {
        const params = new URLSearchParams({
          id_token_hint: session.access_token,
          post_logout_redirect_uri: window.location.origin,
        });
        window.location.href = config.end_session_endpoint + '?' + params.toString();
        return;
      }
    } catch (e) {
      console.error('[Auth] OIDC sign-out cleanup failed:', e);
    }
  },

  /**
   * Redirect to Zitadel's login page where the user can initiate a password reset.
   * Zitadel handles the full reset flow on its hosted UI.
   */
  async resetPasswordForEmail(): Promise<void> {
    await this.signIn();
  },

  /**
   * Get the current session if valid. Returns `null` if no session exists
   * or if the token has expired (triggers a background refresh in that case).
   */
  getSession(): Session | null {
    if (!this._currentSession) return null;
    if (this._currentSession.expires_at * 1000 < Date.now()) {
      void this._refreshSession();
      return null;
    }
    return this._currentSession;
  },

  /**
   * Check if the current URL is an OIDC callback and handle it if so.
   * Call this on app startup to complete any in-progress login.
   * @returns `true` if a callback was detected and handled.
   */
  async restoreSessionFromUrl(): Promise<boolean> {
    if (window.location.pathname === '/auth/callback') {
      return this.handleCallback();
    }
    return false;
  },

  /**
   * Subscribe to auth state changes. The callback fires immediately with
   * `INITIAL_SESSION` and then on every subsequent auth event.
   *
   * @param callback - Listener receiving the event type and current session.
   * @returns Unsubscribe function — call it to stop listening.
   */
  onAuthStateChange(callback: AuthCallback): () => void {
    this._listeners.add(callback);
    const session = this.getSession();
    setTimeout(() => callback('INITIAL_SESSION', session), 0);
    return () => {
      this._listeners.delete(callback);
    };
  },
};

// Initialize session from localStorage on module load
ForumlineAuth._init();
