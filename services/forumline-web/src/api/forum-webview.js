// ========== FORUM WEBVIEW (iframe management) ==========
// Handles webview iframe embedding, postMessage bridge, and login flow.
// Subscribes to ForumStore from @forumline/client-sdk for data.

import { ForumStore } from '@forumline/client-sdk';
import { avatarUrl } from '../lib/avatar.js';

let _webviewIframe = null;
let _messageHandler = null;
let _webviewState = { loading: false, loggingIn: false, hasCalledAuthed: false, loginAttempted: false, authUrl: null };
let _currentWebviewDomain = null;

function _postToForum(msg, origin) {
  if (_webviewIframe && _webviewIframe.contentWindow) _webviewIframe.contentWindow.postMessage(msg, origin);
}

export function showWebview(forum, path) {
  destroyWebview();
  _currentWebviewDomain = forum.domain;
  const container = document.getElementById('webviewIframeWrap');
  const spinner = document.getElementById('webviewSpinner');
  const view = document.getElementById('webviewView');
  if (!container || !view) return;
  const avEl = document.getElementById('webviewAvatar');
  const nmEl = document.getElementById('webviewForumName');
  const mtEl = document.getElementById('webviewForumMeta');
  if (avEl) avEl.src = forum.icon_url ? (forum.icon_url.startsWith('/') ? forum.web_base + forum.icon_url : forum.icon_url) : avatarUrl(forum.seed, 'shapes');
  if (nmEl) nmEl.textContent = forum.name;
  if (mtEl) mtEl.textContent = forum.domain;
  if (spinner) spinner.classList.remove('hidden');

  // Toggle Leave/Join button based on membership
  var leaveBtn = document.getElementById('webviewLeaveBtn');
  var muteBtn = document.getElementById('webviewMuteBtn');
  var isMember = ForumStore.forums.some(f => f.domain === forum.domain);
  if (leaveBtn) {
    leaveBtn.textContent = isMember ? 'Leave' : 'Join';
    leaveBtn.title = isMember ? 'Leave forum' : 'Join forum';
    leaveBtn.dataset.mode = isMember ? 'leave' : 'join';
    leaveBtn.dataset.domain = forum.domain;
  }
  if (muteBtn) muteBtn.style.display = isMember ? '' : 'none';

  const accessToken = ForumStore._accessToken;
  const iframe = document.createElement('iframe');
  iframe.src = forum.web_base + (path || ''); iframe.title = forum.name + ' forum';
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
  iframe.setAttribute('allow', 'clipboard-read; clipboard-write; microphone; display-capture');
  iframe.style.cssText = 'width:100%;height:100%;border:none;';
  container.appendChild(iframe); _webviewIframe = iframe;

  _webviewState = { loading: true, loggingIn: false, hasCalledAuthed: false, loginAttempted: false, authUrl: accessToken ? forum.web_base + '/api/forumline/auth?forumline_token=' + encodeURIComponent(accessToken) : null };
  const forumOrigin = new URL(forum.web_base).origin;
  iframe.addEventListener('load', () => {
    if (spinner) spinner.classList.add('hidden');
    _webviewState.loading = false;
    if (_webviewState.loggingIn) {
      try { var u = new URL(iframe.contentWindow.location.href); var e = u.searchParams.get('error'); if (e) { var m = { auth_failed: 'Forum login failed.', email_exists: 'Account already exists.' }; if (typeof showToast === 'function') showToast(m[e] || 'Login error: ' + e); } } catch (ex) {}
      _webviewState.loggingIn = false; _webviewState.loginAttempted = false;
      setTimeout(() => { if (!_webviewState.hasCalledAuthed) { _webviewState.loginAttempted = true; _postToForum({ type: 'forumline:request_auth_state' }, forumOrigin); } }, 1500);
      return;
    }
    _postToForum({ type: 'forumline:request_auth_state' }, forumOrigin);
  });

  _messageHandler = (event) => {
    if (event.origin !== forumOrigin) return;
    var msg = event.data; if (!msg || !msg.type || msg.type.indexOf('forumline:') !== 0) return;
    switch (msg.type) {
      case 'forumline:ready':
        _postToForum({ type: 'forumline:request_auth_state' }, forumOrigin);
        _postToForum({ type: 'forumline:request_unread_counts' }, forumOrigin);
        break;
      case 'forumline:auth_state':
        if (msg.signedIn) { if (!_webviewState.hasCalledAuthed) { _webviewState.hasCalledAuthed = true; _webviewState.loginAttempted = false; var b = document.getElementById('webviewBanner'); if (b) b.classList.add('hidden'); } }
        else { if (_webviewState.loginAttempted && !_webviewState.hasCalledAuthed && !_webviewState.loggingIn && typeof showToast === 'function') showToast('Login to ' + forum.name + ' did not complete.'); _webviewState.loginAttempted = false; _webviewState.hasCalledAuthed = false; if (_webviewState.authUrl) { var bn = document.getElementById('webviewBanner'); if (bn) bn.classList.remove('hidden'); } }
        break;
      case 'forumline:unread_counts': ForumStore.setUnreadCounts(forum.domain, msg.counts); break;
      case 'forumline:notification': if (msg.notification && msg.notification.title && typeof showToast === 'function') showToast(forum.name + ': ' + msg.notification.title); break;
      case 'forumline:navigate': break;
    }
  };
  window.addEventListener('message', _messageHandler);
  document.querySelectorAll('.view').forEach((v) => { v.classList.add('hidden'); });
  view.classList.remove('hidden');
}

export function destroyWebview() {
  _currentWebviewDomain = null;
  if (_messageHandler) { window.removeEventListener('message', _messageHandler); _messageHandler = null; }
  if (_webviewIframe) { _webviewIframe.remove(); _webviewIframe = null; }
  var b = document.getElementById('webviewBanner'); if (b) b.classList.add('hidden');
  var s = document.getElementById('webviewSpinner'); if (s) s.classList.add('hidden');
}

export function loginToForum() {
  if (!_webviewState.authUrl || !_webviewIframe) return;
  _webviewState.loggingIn = true; _webviewState.loginAttempted = true; _webviewState.loading = true;
  var s = document.getElementById('webviewSpinner'); if (s) s.classList.remove('hidden');
  var b = document.getElementById('webviewBanner'); if (b) b.classList.add('hidden');
  _webviewIframe.src = _webviewState.authUrl;
}

// Subscribe to ForumStore changes to auto-manage webview
ForumStore.subscribe((store) => {
  const active = store.activeForum;
  if (active && active.domain !== _currentWebviewDomain) {
    showWebview(active, store.activePath);
  } else if (!active && _currentWebviewDomain) {
    destroyWebview();
  }
});
