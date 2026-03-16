// ========== FORUMLINE AUTH (Zitadel OIDC PKCE) ==========
// Session management via OIDC Authorization Code + PKCE flow.
// Login/signup happens on Zitadel's hosted login page.
// Tokens stored in localStorage, refresh via refresh_token grant.

const ZITADEL_URL = window.ZITADEL_URL || 'https://auth.forumline.net';
const CLIENT_ID = window.ZITADEL_CLIENT_ID || '';
const REDIRECT_URI = window.location.origin + '/auth/callback';
const AUTH_STORAGE_KEY = 'forumline-session';

// --- PKCE Helpers (RFC 7636) ---

function _randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

function _base64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function _generateCodeVerifier() {
  return _base64url(_randomBytes(32));
}

async function _generateCodeChallenge(verifier) {
  const encoded = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return _base64url(new Uint8Array(digest));
}

// --- OIDC Discovery (cached) ---

let _oidcConfig = null;

async function _getOIDCConfig() {
  if (_oidcConfig) return _oidcConfig;
  const res = await fetch(ZITADEL_URL + '/.well-known/openid-configuration');
  _oidcConfig = await res.json();
  return _oidcConfig;
}

// --- Auth Module ---

export const ForumlineAuth = {
  _listeners: new Set(),
  _refreshTimer: null,
  _currentSession: null,
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
        this._refreshSession();
      } else {
        this._scheduleRefresh(this._currentSession);
      }
    }
  },

  _saveSession(session) {
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

  _scheduleRefresh(session) {
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    const expiresAt = session.expires_at * 1000;
    const refreshIn = Math.max(expiresAt - Date.now() - 60000, 5000);
    this._refreshTimer = setTimeout(() => this._refreshSession(), refreshIn);
  },

  get isRefreshing() { return this._isRefreshing; },

  async _refreshSession() {
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
          refresh_token: this._currentSession.refresh_token,
        }),
      });
      if (!res.ok) {
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

  _tokenResponseToSession(data) {
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
          display_name: [idPayload.given_name, idPayload.family_name].filter(Boolean).join(' ') || idPayload.preferred_username || '',
        },
      },
    };
  },

  _emit(event, session) {
    for (const cb of this._listeners) {
      try { cb(event, session); } catch (err) { console.error('[Forumline:Auth] listener error:', err); }
    }
  },

  // Redirect to Zitadel's hosted login page (OIDC Authorization Code + PKCE)
  async signIn() {
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

  // Redirect to Zitadel's registration page
  async signUp() {
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

  // Handle the OIDC callback — exchange auth code for tokens
  async handleCallback() {
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
      if (!res.ok) return false;

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

  async signOut() {
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
    } catch {}
  },

  // Zitadel handles password reset via its hosted UI
  async resetPasswordForEmail() {
    await this.signIn(); // redirect to Zitadel login, user can reset from there
  },

  getSession() {
    if (!this._currentSession) return null;
    if (this._currentSession.expires_at * 1000 < Date.now()) {
      this._refreshSession();
      return null;
    }
    return this._currentSession;
  },

  // Check if current URL is an OIDC callback
  async restoreSessionFromUrl() {
    if (window.location.pathname === '/auth/callback') {
      return this.handleCallback();
    }
    return false;
  },

  onAuthStateChange(callback) {
    this._listeners.add(callback);
    const session = this.getSession();
    setTimeout(() => callback('INITIAL_SESSION', session), 0);
    return () => { this._listeners.delete(callback); };
  },
};

// Initialize session from localStorage on module load
ForumlineAuth._init();
