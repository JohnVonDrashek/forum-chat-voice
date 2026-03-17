// ========== FORUM WEBVIEW (iframe management) ==========
// Handles webview iframe embedding and the "invisible handshake" auth flow.
// When a user opens a forum in the app, their Forumline JWT is passed to the
// forum via postMessage. The forum exchanges it for a local session — zero
// clicks, zero redirects, seamless.

import { ForumStore } from '@forumline/client-sdk';
import { avatarUrl } from '../lib/avatar.js';

let _webviewIframe = null;
let _messageHandler = null;
let _webviewState = { loading: false, authSent: false };
let _currentWebviewDomain = null;

function _postToForum(msg, origin) {
  if (_webviewIframe && _webviewIframe.contentWindow)
    _webviewIframe.contentWindow.postMessage(msg, origin);
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
  if (avEl)
    avEl.src = forum.icon_url
      ? forum.icon_url.startsWith('/')
        ? forum.web_base + forum.icon_url
        : forum.icon_url
      : avatarUrl(forum.seed, 'shapes');
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
  iframe.src = forum.web_base + (path || '');
  iframe.title = forum.name + ' forum';
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
  iframe.setAttribute('allow', 'clipboard-read; clipboard-write; microphone; display-capture');
  iframe.style.cssText = 'width:100%;height:100%;border:none;';
  container.appendChild(iframe);
  _webviewIframe = iframe;

  _webviewState = { loading: true, authSent: false };
  const forumOrigin = new URL(forum.web_base).origin;

  iframe.addEventListener('load', () => {
    if (spinner) spinner.classList.add('hidden');
    _webviewState.loading = false;
  });

  _messageHandler = event => {
    if (event.origin !== forumOrigin) return;
    var msg = event.data;
    if (!msg || !msg.type || msg.type.indexOf('forumline:') !== 0) return;

    switch (msg.type) {
      case 'forumline:ready':
        // Forum iframe loaded — send the invisible handshake if we have a token
        if (accessToken && !_webviewState.authSent) {
          _webviewState.authSent = true;
          _postToForum({ type: 'forumline:token_exchange', token: accessToken }, forumOrigin);
        } else {
          _postToForum({ type: 'forumline:request_auth_state' }, forumOrigin);
        }
        _postToForum({ type: 'forumline:request_unread_counts' }, forumOrigin);
        break;

      case 'forumline:auth_state':
        if (msg.signedIn) {
          // User is authenticated in the forum — hide any login banners
          var b = document.getElementById('webviewBanner');
          if (b) b.classList.add('hidden');
        } else if (!_webviewState.authSent && accessToken) {
          // Forum says not signed in but we have a token — try the handshake
          _webviewState.authSent = true;
          _postToForum({ type: 'forumline:token_exchange', token: accessToken }, forumOrigin);
        }
        break;

      case 'forumline:auth_complete':
        // Invisible handshake succeeded
        var bn = document.getElementById('webviewBanner');
        if (bn) bn.classList.add('hidden');
        break;

      case 'forumline:unread_counts':
        ForumStore.setUnreadCounts(forum.domain, msg.counts);
        break;

      case 'forumline:notification':
        if (msg.notification && msg.notification.title && typeof showToast === 'function') {
          showToast(forum.name + ': ' + msg.notification.title);
        }
        break;

      case 'forumline:navigate':
        break;
    }
  };
  window.addEventListener('message', _messageHandler);
  document.querySelectorAll('.view').forEach(v => {
    v.classList.add('hidden');
  });
  view.classList.remove('hidden');
}

export function destroyWebview() {
  _currentWebviewDomain = null;
  if (_messageHandler) {
    window.removeEventListener('message', _messageHandler);
    _messageHandler = null;
  }
  if (_webviewIframe) {
    _webviewIframe.remove();
    _webviewIframe = null;
  }
  var b = document.getElementById('webviewBanner');
  if (b) b.classList.add('hidden');
  var s = document.getElementById('webviewSpinner');
  if (s) s.classList.add('hidden');
}

// Subscribe to ForumStore changes to auto-manage webview
ForumStore.subscribe(store => {
  const active = store.activeForum;
  if (active && active.domain !== _currentWebviewDomain) {
    showWebview(active, store.activePath);
  } else if (!active && _currentWebviewDomain) {
    destroyWebview();
  }
});
