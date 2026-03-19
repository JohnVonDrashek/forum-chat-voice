/**
 * @module auth
 *
 * OIDC Authorization Code + PKCE authentication against Zitadel,
 * powered by oidc-client-ts. Manages the full login lifecycle:
 * sign-in/sign-up redirects, callback handling, token persistence
 * in localStorage, and automatic background refresh.
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

import { User, UserManager, WebStorageStateStore } from 'oidc-client-ts';

declare const window: Window &
  typeof globalThis & {
    ZITADEL_URL?: string;
    ZITADEL_CLIENT_ID?: string;
  };

const ZITADEL_URL = window.ZITADEL_URL || 'https://auth.forumline.net';
const CLIENT_ID = window.ZITADEL_CLIENT_ID || '';
const REDIRECT_URI = window.location.origin + '/auth/callback';

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

// --- oidc-client-ts UserManager ---

const _mgr = new UserManager({
  authority: ZITADEL_URL,
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT_URI,
  post_logout_redirect_uri: window.location.origin,
  scope: 'openid profile email offline_access',
  automaticSilentRenew: false, // We fire refresh manually for event control
  userStore: new WebStorageStateStore({ store: window.localStorage }),
});

// --- Helpers ---

/** Map oidc-client-ts User to our Session type. */
function _userToSession(user: User): Session {
  const p = user.profile;
  const preferred = (p as Record<string, unknown>).preferred_username as string | undefined;
  return {
    access_token: user.access_token,
    refresh_token: user.refresh_token,
    expires_in: user.expires_in ?? 3600,
    expires_at: user.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: p.sub,
      email: (p.email as string) ?? '',
      user_metadata: {
        username: preferred ?? '',
        display_name:
          [p.given_name, p.family_name].filter(Boolean).join(' ') || preferred || '',
      },
    },
  };
}

/** oidc-client-ts localStorage key for the stored user. */
const _storageKey = `oidc.user:${ZITADEL_URL}:${CLIENT_ID}`;

// --- Auth Module ---

/**
 * Singleton auth manager. Wraps oidc-client-ts UserManager with
 * Forumline-specific session types and event dispatching.
 */
export const ForumlineAuth = {
  _listeners: new Set<AuthCallback>(),
  _currentSession: null as Session | null,
  _isRefreshing: false,

  _init() {
    // Sync: populate cache from localStorage for immediate getSession() availability
    const stored = localStorage.getItem(_storageKey);
    if (stored) {
      try {
        const user = User.fromStorageString(stored);
        if (user && !user.expired) {
          this._currentSession = _userToSession(user);
        }
      } catch {}
    }

    // Clean up legacy storage key from hand-rolled auth
    localStorage.removeItem('forumline-session');

    // Schedule refresh 60s before token expiry
    _mgr.events.addAccessTokenExpiring(() => {
      void this._refreshSession();
    });

    // Async: validate stored user and start expiry timer (fire-and-forget)
    void _mgr.getUser().then(user => {
      if (user?.expired) {
        void this._refreshSession();
      }
    });
  },

  /** Whether a token refresh is currently in progress. */
  get isRefreshing(): boolean {
    return this._isRefreshing;
  },

  async _refreshSession(): Promise<boolean> {
    this._isRefreshing = true;
    try {
      const user = await _mgr.signinSilent();
      this._isRefreshing = false;
      if (user) {
        this._currentSession = _userToSession(user);
        this._emit('TOKEN_REFRESHED', this._currentSession);
        return true;
      }
      return false;
    } catch (err) {
      console.error('[Auth] token refresh failed, signing out:', err);
      this._isRefreshing = false;
      this._currentSession = null;
      await _mgr.removeUser();
      this._emit('SIGNED_OUT', null);
      return false;
    }
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
   * Uses OIDC Authorization Code flow with PKCE (handled by oidc-client-ts).
   * The browser will navigate away — call {@link handleCallback} on return.
   */
  async signIn(): Promise<void> {
    await _mgr.signinRedirect({ prompt: 'login' });
  },

  /**
   * Redirect the user to Zitadel's registration page.
   * Same PKCE flow as {@link signIn} but with `prompt=create`.
   */
  async signUp(): Promise<void> {
    await _mgr.signinRedirect({ prompt: 'create' });
  },

  /**
   * Handle the OIDC callback after Zitadel redirects back.
   * Exchanges the authorization code for tokens and stores the session.
   * @returns `true` if the callback was handled successfully, `false` otherwise.
   */
  async handleCallback(): Promise<boolean> {
    try {
      const user = await _mgr.signinRedirectCallback();
      if (user) {
        this._currentSession = _userToSession(user);
        window.history.replaceState({}, '', '/');
        this._emit('SIGNED_IN', this._currentSession);
        return true;
      }
      return false;
    } catch (err) {
      console.error('[Auth] callback handling failed:', err);
      return false;
    }
  },

  /**
   * Sign out the current user. Clears local session and redirects to
   * Zitadel's end-session endpoint to clear the IdP session too.
   */
  async signOut(): Promise<void> {
    this._currentSession = null;
    this._emit('SIGNED_OUT', null);
    try {
      await _mgr.signoutRedirect();
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
