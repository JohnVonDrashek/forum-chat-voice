// ========== DEEP LINKING ==========
// Parse and handle deep links (forumline:// protocol and URL params).

import { ForumlineAPI } from '@forumline/client-sdk';

export function parseDeepLink(url) {
  try {
    const dm = url.match(/^forumline:\/\/dm\/([^/]+)$/);
    if (dm) return { dm: dm[1] };
    const m = url.match(/^forumline:\/\/forum\/([^/]+)(.*)$/);
    return m ? { domain: m[1], path: m[2] || '/' } : null;
  } catch {
    return null;
  }
}

export function handleDeepLinkParams(params) {
  if (!params?.forum && !params?.dm) return;
  console.log('[DeepLink] Navigate:', params.forum || params.dm, params.path);
  if (params.dm) {
    // Handle forumline://dm/userId -- find conversation by participant userId
    if (typeof window.DmStore !== 'undefined' && typeof window.showDm === 'function') {
      const convo = window.DmStore.getConversations().find(
        c =>
          c.participants && c.participants.some(p => p.id === params.dm || p.user_id === params.dm),
      );
      if (convo) window.showDm(convo.id);
    }
    return;
  }
  // Try ForumStore real forums first (match by domain)
  if (typeof window.ForumStore !== 'undefined') {
    const real = window.ForumStore.forums.find(f => f.domain === params.forum);
    if (real) {
      window.ForumStore.switchForum(real.domain);
      return;
    }
  }
  // Fall back to mock forums list
  if (typeof window.forums !== 'undefined' && typeof window.showForum === 'function') {
    const forum = window.forums.find(
      f => f.seed === params.forum || f.name.toLowerCase().replace(/\s+/g, '-') === params.forum,
    );
    if (forum) window.showForum(forum.id);
  }
}

export function checkUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const forum = params.get('forum');
  if (forum) {
    handleDeepLinkParams({ forum: forum, path: params.get('path') });
    window.history.replaceState({}, '', window.location.pathname);
  }
  // Auth recovery from URL hash
  const hash = window.location.hash;
  if (hash && hash.includes('access_token=')) {
    const hp = new URLSearchParams(hash.substring(1));
    const token = hp.get('access_token');
    if (token) {
      ForumlineAPI.configure({ accessToken: token });
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }
}
