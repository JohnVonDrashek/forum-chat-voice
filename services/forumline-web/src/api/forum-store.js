// ========== FORUM STORE (Real API Integration) ==========
// Manages forum memberships, webview embedding, and discovery.
// Server is the source of truth; localStorage is a cache.

import { ForumlineAPI } from './client.js';

export const ForumStore = {
  _accessToken: null,
  _forums: [],
  _activeForum: null,
  _unreadCounts: {},
  _subscribers: [],
  _webviewIframe: null,
  _messageHandler: null,
  _webviewState: { loading: false, loggingIn: false, hasCalledAuthed: false, loginAttempted: false, authUrl: null },

  get forums() { return this._forums; },
  get activeForum() { return this._activeForum; },

  subscribe(fn) { this._subscribers.push(fn); return () => { this._subscribers = this._subscribers.filter(f => f !== fn); }; },
  _notify() {
    for (const fn of this._subscribers) { try { fn(this); } catch (e) { console.error(e); } }
    if (typeof renderForumList === 'function') try { renderForumList(); } catch(e) {}
  },

  async syncFromServer(accessToken) {
    if (accessToken) this._accessToken = accessToken;
    if (!this._accessToken) return;
    try {
      const res = await fetch('/api/memberships', { headers: { Authorization: `Bearer ${this._accessToken}` } });
      if (!res.ok) return;
      const memberships = await res.json();
      this._forums = (memberships || []).map(m => ({
        domain: m.forum_domain, name: m.forum_name, icon_url: m.forum_icon_url || '',
        web_base: m.web_base, api_base: m.api_base, capabilities: m.capabilities || [],
        added_at: m.joined_at, id: 'real_' + m.forum_domain.replace(/[^a-z0-9]/g, '_'),
        seed: m.forum_domain, members: m.member_count || 0, unread: 0, threads: 0, isReal: true,
      }));
      try { localStorage.setItem('forumline-memberships', JSON.stringify(this._forums)); } catch (e) {}
      this._notify();
    } catch (e) { console.warn('Failed to sync memberships:', e); }
  },

  loadCache() {
    try { const c = localStorage.getItem('forumline-memberships'); if (c) { this._forums = JSON.parse(c); this._notify(); } } catch (e) {}
  },

  async fetchManifest(url) {
    let n = url.trim(); if (!/^https?:\/\//i.test(n)) n = 'https://' + n;
    const mu = n.includes('/.well-known/forumline-manifest.json') ? n : n.replace(/\/$/, '') + '/.well-known/forumline-manifest.json';
    const r = await fetch(mu); if (!r.ok) throw new Error('Forum returned HTTP ' + r.status + ': not a valid Forumline forum');
    const m = await r.json(); if (m.forumline_version !== '1') throw new Error('Unsupported version: ' + m.forumline_version); return m;
  },

  async addForum(url) {
    const manifest = await this.fetchManifest(url);
    if (this._forums.some(f => f.domain === manifest.domain)) throw new Error('Already joined');
    if (this._accessToken) {
      try { await fetch('/api/memberships/join', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this._accessToken }, body: JSON.stringify({ forum_domain: manifest.domain }) }); } catch (e) {}
    }
    const mem = { domain: manifest.domain, name: manifest.name, icon_url: manifest.icon_url || '', web_base: manifest.web_base, api_base: manifest.api_base, capabilities: manifest.capabilities || [], added_at: new Date().toISOString(), id: 'real_' + manifest.domain.replace(/[^a-z0-9]/g, '_'), seed: manifest.domain, members: 0, unread: 0, threads: 0, isReal: true };
    this._forums.push(mem);
    try { localStorage.setItem('forumline-memberships', JSON.stringify(this._forums)); } catch (e) {}
    this._notify(); return mem;
  },

  async leaveForum(domain) {
    if (this._accessToken) { try { await fetch('/api/memberships', { method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this._accessToken }, body: JSON.stringify({ forum_domain: domain }) }); } catch (e) {} }
    this._forums = this._forums.filter(f => f.domain !== domain);
    if (this._activeForum && this._activeForum.domain === domain) { this._activeForum = null; this.destroyWebview(); }
    try { localStorage.setItem('forumline-memberships', JSON.stringify(this._forums)); } catch (e) {}
    this._notify();
  },

  async toggleMute(domain) {
    if (!this._accessToken) return;
    try { await fetch('/api/memberships/' + encodeURIComponent(domain) + '/mute', { method: 'POST', headers: { Authorization: 'Bearer ' + this._accessToken } }); } catch (e) {}
  },

  switchForum(domain) {
    const forum = this._forums.find(f => f.domain === domain);
    if (!forum) return; this._activeForum = forum; this._notify(); this.showWebview(forum);
  },

  goHome() { this._activeForum = null; this.destroyWebview(); this._notify(); },

  setUnreadCounts(domain, counts) {
    this._unreadCounts[domain] = counts;
    const f = this._forums.find(f => f.domain === domain);
    if (f) f.unread = (counts.notifications || 0) + (counts.chat_mentions || 0) + (counts.dms || 0);
    this._notify();
  },

  showWebview(forum) {
    this.destroyWebview();
    const container = document.getElementById('webviewIframeWrap');
    const spinner = document.getElementById('webviewSpinner');
    const view = document.getElementById('webviewView');
    if (!container || !view) return;
    const avEl = document.getElementById('webviewAvatar');
    const nmEl = document.getElementById('webviewForumName');
    const mtEl = document.getElementById('webviewForumMeta');
    if (avEl) avEl.src = forum.icon_url ? (forum.icon_url.startsWith('/') ? forum.web_base + forum.icon_url : forum.icon_url) : 'https://api.dicebear.com/7.x/shapes/svg?seed=' + forum.seed;
    if (nmEl) nmEl.textContent = forum.name;
    if (mtEl) mtEl.textContent = forum.domain;
    if (spinner) spinner.classList.remove('hidden');

    const iframe = document.createElement('iframe');
    iframe.src = forum.web_base; iframe.title = forum.name + ' forum';
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
    iframe.setAttribute('allow', 'clipboard-read; clipboard-write; microphone; display-capture');
    iframe.style.cssText = 'width:100%;height:100%;border:none;';
    container.appendChild(iframe); this._webviewIframe = iframe;

    this._webviewState = { loading: true, loggingIn: false, hasCalledAuthed: false, loginAttempted: false, authUrl: this._accessToken ? '/api/auth/forum-login/' + encodeURIComponent(forum.domain) : null };
    const forumOrigin = new URL(forum.web_base).origin;
    iframe.addEventListener('load', () => {
      if (spinner) spinner.classList.add('hidden');
      this._webviewState.loading = false;
      if (this._webviewState.loggingIn) {
        try { var u = new URL(iframe.contentWindow.location.href); var e = u.searchParams.get('error'); if (e) { var m = { auth_failed: 'Forum login failed.', email_exists: 'Account already exists.' }; if (typeof showToast === 'function') showToast(m[e] || 'Login error: ' + e); } } catch (ex) {}
        this._webviewState.loggingIn = false; this._webviewState.loginAttempted = false;
        setTimeout(() => { if (!this._webviewState.hasCalledAuthed) { this._webviewState.loginAttempted = true; this._postToForum({ type: 'forumline:request_auth_state' }, forumOrigin); } }, 1500);
        return;
      }
      this._postToForum({ type: 'forumline:request_auth_state' }, forumOrigin);
    });

    this._messageHandler = (event) => {
      if (event.origin !== forumOrigin) return;
      var msg = event.data; if (!msg || !msg.type || msg.type.indexOf('forumline:') !== 0) return;
      switch (msg.type) {
        case 'forumline:ready':
          this._postToForum({ type: 'forumline:request_auth_state' }, forumOrigin);
          this._postToForum({ type: 'forumline:request_unread_counts' }, forumOrigin);
          break;
        case 'forumline:auth_state':
          if (msg.signedIn) { if (!this._webviewState.hasCalledAuthed) { this._webviewState.hasCalledAuthed = true; this._webviewState.loginAttempted = false; var b = document.getElementById('webviewBanner'); if (b) b.classList.add('hidden'); } }
          else { if (this._webviewState.loginAttempted && !this._webviewState.hasCalledAuthed && !this._webviewState.loggingIn && typeof showToast === 'function') showToast('Login to ' + forum.name + ' did not complete.'); this._webviewState.loginAttempted = false; this._webviewState.hasCalledAuthed = false; if (this._webviewState.authUrl) { var bn = document.getElementById('webviewBanner'); if (bn) bn.classList.remove('hidden'); } }
          break;
        case 'forumline:unread_counts': this.setUnreadCounts(forum.domain, msg.counts); break;
        case 'forumline:notification': if (msg.notification && msg.notification.title && typeof showToast === 'function') showToast(forum.name + ': ' + msg.notification.title); break;
        case 'forumline:navigate': break;
      }
    };
    window.addEventListener('message', this._messageHandler);
    document.querySelectorAll('.view').forEach((v) => { v.classList.add('hidden'); });
    view.classList.remove('hidden');
  },

  _postToForum(msg, origin) { if (this._webviewIframe && this._webviewIframe.contentWindow) this._webviewIframe.contentWindow.postMessage(msg, origin); },

  destroyWebview() {
    if (this._messageHandler) { window.removeEventListener('message', this._messageHandler); this._messageHandler = null; }
    if (this._webviewIframe) { this._webviewIframe.remove(); this._webviewIframe = null; }
    var b = document.getElementById('webviewBanner'); if (b) b.classList.add('hidden');
    var s = document.getElementById('webviewSpinner'); if (s) s.classList.add('hidden');
  },

  loginToForum() {
    if (!this._webviewState.authUrl || !this._webviewIframe) return;
    this._webviewState.loggingIn = true; this._webviewState.loginAttempted = true; this._webviewState.loading = true;
    var s = document.getElementById('webviewSpinner'); if (s) s.classList.remove('hidden');
    var b = document.getElementById('webviewBanner'); if (b) b.classList.add('hidden');
    this._webviewIframe.src = this._webviewState.authUrl;
  },

  clear() {
    this._accessToken = null; this._forums = []; this._activeForum = null; this._unreadCounts = {};
    this.destroyWebview(); try { localStorage.removeItem('forumline-memberships'); } catch (e) {} this._notify();
  },
};
