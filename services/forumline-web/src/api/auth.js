// ========== FORUMLINE AUTH (GoTrue) ==========
// Session management, sign in/up/out, token refresh, password reset.

const FORUMLINE_API_BASE = window.FORUMLINE_API_BASE || window.location.origin || 'https://app.forumline.net';
const AUTH_STORAGE_KEY = 'forumline-session';

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
      const res = await fetch(FORUMLINE_API_BASE + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: this._currentSession.refresh_token }),
      });
      if (!res.ok) {
        this._isRefreshing = false;
        this._saveSession(null);
        this._emit('SIGNED_OUT', null);
        return false;
      }
      const data = await res.json();
      const session = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
        expires_at: data.expires_at,
        user: data.user || this._currentSession.user,
      };
      this._isRefreshing = false;
      this._saveSession(session);
      this._emit('TOKEN_REFRESHED', session);
      return true;
    } catch {
      this._isRefreshing = false;
      return false;
    }
  },

  _emit(event, session) {
    for (const cb of this._listeners) {
      try { cb(event, session); } catch (err) { console.error('[Forumline:Auth] listener error:', err); }
    }
  },

  async signIn(email, password) {
    try {
      const res = await fetch(FORUMLINE_API_BASE + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json();
      if (!res.ok) {
        return { error: new Error(body.error || 'Login failed') };
      }
      const session = {
        access_token: body.session.access_token,
        refresh_token: body.session.refresh_token,
        expires_in: body.session.expires_in || 3600,
        expires_at: body.session.expires_at,
        user: {
          id: body.user.id,
          email: body.user.email,
          user_metadata: body.user.user_metadata,
        },
      };
      this._saveSession(session);
      this._emit('SIGNED_IN', session);
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err : new Error('Login failed') };
    }
  },

  async signUp(email, password, username) {
    try {
      const res = await fetch(FORUMLINE_API_BASE + '/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, username }),
      });
      const body = await res.json();
      if (!res.ok) {
        return { error: new Error(body.error || 'Signup failed') };
      }
      const session = {
        access_token: body.session.access_token,
        refresh_token: body.session.refresh_token,
        expires_in: body.session.expires_in || 3600,
        expires_at: body.session.expires_at,
        user: {
          id: body.user.id,
          email: body.user.email,
          user_metadata: body.user.user_metadata,
        },
      };
      this._saveSession(session);
      this._emit('SIGNED_IN', session);
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err : new Error('Signup failed') };
    }
  },

  async signOut() {
    try {
      await fetch(FORUMLINE_API_BASE + '/api/auth/logout', { method: 'POST' });
    } catch {}
    this._saveSession(null);
    this._emit('SIGNED_OUT', null);
  },

  async resetPasswordForEmail(email) {
    try {
      const res = await fetch(FORUMLINE_API_BASE + '/auth/v1/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { error: new Error(body.msg || 'Password reset failed') };
      }
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err : new Error('Password reset failed') };
    }
  },

  async updateUser(data) {
    if (!this._currentSession) {
      return { error: new Error('Not authenticated') };
    }
    try {
      const res = await fetch(FORUMLINE_API_BASE + '/auth/v1/user', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + this._currentSession.access_token,
        },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { error: new Error(body.msg || 'Password update failed') };
      }
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err : new Error('Password update failed') };
    }
  },

  getSession() {
    if (!this._currentSession) return null;
    if (this._currentSession.expires_at * 1000 < Date.now()) {
      this._refreshSession();
      return null;
    }
    return this._currentSession;
  },

  async restoreSessionFromUrl() {
    const hash = window.location.hash;
    if (!hash) return false;
    const params = new URLSearchParams(hash.substring(1));
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    if (!accessToken || !refreshToken) return false;

    try {
      const userRes = await fetch(FORUMLINE_API_BASE + '/auth/v1/user', {
        headers: { 'Authorization': 'Bearer ' + accessToken },
      });
      if (!userRes.ok) return false;
      const user = await userRes.json();

      const payload = JSON.parse(atob(accessToken.split('.')[1]));
      const session = {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: (payload.exp - payload.iat) || 3600,
        expires_at: payload.exp || Math.floor(Date.now() / 1000) + 3600,
        user: {
          id: user.id,
          email: user.email || '',
          user_metadata: user.user_metadata,
        },
      };
      this._saveSession(session);

      const type = params.get('type');
      if (type === 'recovery') {
        this._emit('PASSWORD_RECOVERY', session);
      } else {
        this._emit('SIGNED_IN', session);
      }
      window.history.replaceState({}, '', window.location.pathname);
      return true;
    } catch {
      return false;
    }
  },

  onAuthStateChange(callback) {
    this._listeners.add(callback);
    const session = this.getSession();
    setTimeout(() => callback('INITIAL_SESSION', session), 0);
    return () => { this._listeners.delete(callback); };
  },
};
