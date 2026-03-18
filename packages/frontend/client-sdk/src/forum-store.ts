/**
 * @module forum-store
 *
 * Reactive store for the user's forum memberships. Server is the source of truth;
 * localStorage serves as a fast cache for instant sidebar rendering on app load.
 *
 * @example
 * ```ts
 * ForumStore.loadCache();
 * await ForumStore.syncFromServer(accessToken);
 * ForumStore.subscribe((store) => renderSidebar(store.forums));
 * ```
 */

import type { ForumCapability } from '@forumline/protocol';

/** A forum the user is a member of, with local UI state (unread counts, active state). */
export interface ForumMembership {
  /** Forum's canonical domain. */
  domain: string;
  /** Human-readable forum name. */
  name: string;
  /** Forum icon URL. */
  icon_url: string;
  /** Base URL for the forum's web UI (loaded in iframe). */
  web_base: string;
  /** Base URL for the forum's API endpoints. */
  api_base: string;
  /** Features this forum supports (threads, chat, voice, notifications). */
  capabilities: ForumCapability[];
  /** ISO timestamp of when the user joined. */
  added_at: string;
  /** Local unique ID for keying in UI lists. */
  id: string;
  /** Seed value for DiceBear avatar generation. */
  seed: string;
  /** Approximate member count. */
  members: number;
  /** Aggregated unread count (notifications + chat mentions + DMs). */
  unread: number;
  /** Thread count (reserved for future use). */
  threads: number;
  /** Always `true` for server-synced memberships. */
  isReal: boolean;
  /** Whether notifications from this forum are muted. */
  muted?: boolean;
}

/** Per-forum unread counts received from the forum's `/unread` endpoint. */
export interface ForumUnreadCounts {
  /** Unread notification count. */
  notifications?: number;
  /** Unread chat mention count. */
  chat_mentions?: number;
  /** Unread DM count. */
  dms?: number;
}

type ForumStoreSubscriber = (store: typeof ForumStore) => void;
type Unsubscribe = () => void;

/**
 * Reactive forum membership store. Manages the list of forums the user
 * has joined, syncs with the server, and caches in localStorage.
 */
export const ForumStore = {
  _accessToken: null as string | null,
  _forums: [] as ForumMembership[],
  _activeForum: null as ForumMembership | null,
  _activePath: '',
  _unreadCounts: {} as Record<string, ForumUnreadCounts>,
  _subscribers: [] as ForumStoreSubscriber[],

  /** The user's current forum memberships. */
  get forums(): ForumMembership[] {
    return this._forums;
  },
  /** The currently selected forum (shown in the main content area), or `null` for home. */
  get activeForum(): ForumMembership | null {
    return this._activeForum;
  },
  /** The current path within the active forum's iframe. */
  get activePath(): string {
    return this._activePath;
  },

  /**
   * Subscribe to store changes. Fires on membership list updates,
   * active forum changes, and unread count updates.
   * @returns Unsubscribe function.
   */
  subscribe(fn: ForumStoreSubscriber): Unsubscribe {
    this._subscribers.push(fn);
    return () => {
      this._subscribers = this._subscribers.filter(f => f !== fn);
    };
  },
  _notify(): void {
    for (const fn of this._subscribers) {
      try {
        fn(this);
      } catch (e) {
        console.error(e);
      }
    }
  },

  /**
   * Fetch the user's forum memberships from the server and update the store.
   * Optionally accepts an access token (useful on first call after login).
   * @param accessToken - If provided, updates the stored token.
   */
  async syncFromServer(accessToken?: string): Promise<void> {
    if (accessToken) this._accessToken = accessToken;
    if (!this._accessToken) return;
    try {
      const res = await fetch('/api/memberships', {
        headers: { Authorization: `Bearer ${this._accessToken}` },
      });
      if (!res.ok) {
        console.error('[ForumStore] membership sync failed:', res.status);
        return;
      }
      const memberships: Array<{
        forum_domain: string;
        forum_name: string;
        forum_icon_url?: string;
        web_base: string;
        api_base: string;
        capabilities?: ForumCapability[];
        joined_at: string;
        member_count?: number;
      }> = await res.json();
      this._forums = (memberships || []).map(m => ({
        domain: m.forum_domain,
        name: m.forum_name,
        icon_url: m.forum_icon_url || '',
        web_base: m.web_base,
        api_base: m.api_base,
        capabilities: m.capabilities || [],
        added_at: m.joined_at,
        id: 'real_' + m.forum_domain.replace(/[^a-z0-9]/g, '_'),
        seed: m.forum_domain,
        members: m.member_count || 0,
        unread: 0,
        threads: 0,
        isReal: true,
      }));
      try {
        localStorage.setItem('forumline-memberships', JSON.stringify(this._forums));
      } catch {}
      this._notify();
    } catch (e) {
      console.warn('Failed to sync memberships:', e);
    }
  },

  /** Load cached memberships from localStorage for instant UI rendering. */
  loadCache(): void {
    try {
      const c = localStorage.getItem('forumline-memberships');
      if (c) {
        this._forums = JSON.parse(c);
        this._notify();
      }
    } catch {}
  },

  /**
   * Fetch and validate a forum's manifest from its well-known URL.
   * @param url - Forum URL or domain (protocol optional).
   * @throws {Error} If the forum doesn't serve a valid manifest.
   */
  async fetchManifest(url: string): Promise<{ forumline_version: string; [key: string]: unknown }> {
    let n = url.trim();
    if (!/^https?:\/\//i.test(n)) n = 'https://' + n;
    const mu = n.includes('/.well-known/forumline-manifest.json')
      ? n
      : n.replace(/\/$/, '') + '/.well-known/forumline-manifest.json';
    const r = await fetch(mu);
    if (!r.ok) throw new Error('Forum returned HTTP ' + r.status + ': not a valid Forumline forum');
    const m = await r.json();
    if (m.forumline_version !== '1') throw new Error('Unsupported version: ' + m.forumline_version);
    return m;
  },

  /**
   * Join a forum by URL or domain. Calls the server-side join endpoint
   * which validates the forum's manifest internally (avoids CORS issues).
   * @param url - Forum URL or bare domain (e.g. `"testforum.forumline.net"`).
   * @throws {Error} If already joined, not authenticated, or the join fails.
   */
  async addForum(url: string): Promise<ForumMembership> {
    const domain = url
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '');
    if (!domain) throw new Error('Please enter a forum URL or domain');
    if (this._forums.some(f => f.domain === domain)) throw new Error('Already joined this forum');
    if (!this._accessToken) throw new Error('You must be signed in to add a forum');

    const res = await fetch('/api/memberships/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this._accessToken },
      body: JSON.stringify({ forum_domain: domain }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to add forum (HTTP ' + res.status + ')');
    }
    const info: {
      domain: string;
      name: string;
      icon_url?: string;
      web_base: string;
      api_base: string;
      capabilities?: ForumCapability[];
      joined_at?: string;
      member_count?: number;
    } = await res.json();
    const mem: ForumMembership = {
      domain: info.domain,
      name: info.name,
      icon_url: info.icon_url || '',
      web_base: info.web_base,
      api_base: info.api_base,
      capabilities: info.capabilities || [],
      added_at: info.joined_at || new Date().toISOString(),
      id: 'real_' + info.domain.replace(/[^a-z0-9]/g, '_'),
      seed: info.domain,
      members: info.member_count || 1,
      unread: 0,
      threads: 0,
      isReal: true,
    };
    this._forums.push(mem);
    try {
      localStorage.setItem('forumline-memberships', JSON.stringify(this._forums));
    } catch {}
    this._notify();
    return mem;
  },

  /**
   * Join a forum by domain when you already have its info (e.g. from discovery results).
   * @param domain - Forum domain to join.
   * @param forumInfo - Optional pre-fetched forum metadata to avoid an extra lookup.
   * @throws {Error} If already joined or not authenticated.
   */
  async joinByDomain(
    domain: string,
    forumInfo?: Partial<ForumMembership>,
  ): Promise<ForumMembership> {
    if (this._forums.some(f => f.domain === domain)) throw new Error('Already joined');
    if (!this._accessToken) throw new Error('Not authenticated');
    const res = await fetch('/api/memberships/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this._accessToken },
      body: JSON.stringify({ forum_domain: domain }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error('Join failed: ' + (text || res.status));
    }
    const info = forumInfo || {};
    const mem: ForumMembership = {
      domain: domain,
      name: info.name || domain,
      icon_url: info.icon_url || '',
      web_base: info.web_base || 'https://' + domain,
      api_base: info.api_base || '',
      capabilities: info.capabilities || [],
      added_at: new Date().toISOString(),
      id: 'real_' + domain.replace(/[^a-z0-9]/g, '_'),
      seed: domain,
      members: info.members || 0,
      unread: 0,
      threads: 0,
      isReal: true,
    };
    this._forums.push(mem);
    try {
      localStorage.setItem('forumline-memberships', JSON.stringify(this._forums));
    } catch {}
    this._notify();
    return mem;
  },

  /**
   * Leave a forum. Removes the membership on the server and locally.
   * If this was the active forum, switches back to home.
   */
  async leaveForum(domain: string): Promise<void> {
    if (this._accessToken) {
      try {
        await fetch('/api/memberships', {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + this._accessToken,
          },
          body: JSON.stringify({ forum_domain: domain }),
        });
      } catch (e) {
        console.error('[ForumStore] leave request failed:', e);
      }
    }
    this._forums = this._forums.filter(f => f.domain !== domain);
    if (this._activeForum && this._activeForum.domain === domain) {
      this._activeForum = null;
    }
    try {
      localStorage.setItem('forumline-memberships', JSON.stringify(this._forums));
    } catch {}
    this._notify();
  },

  /**
   * Toggle notification mute for a forum.
   * @param domain - Forum domain to mute/unmute.
   */
  async toggleMute(domain: string): Promise<void> {
    if (!this._accessToken) return;
    const forum = this._forums.find(f => f.domain === domain);
    const newMuted = forum ? !forum.muted : true;
    try {
      await fetch('/api/memberships', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + this._accessToken,
        },
        body: JSON.stringify({ forum_domain: domain, muted: newMuted }),
      });
      if (forum) forum.muted = newMuted;
    } catch (e) {
      console.error('[ForumStore] mute request failed:', e);
    }
  },

  /**
   * Switch the active forum (loads its iframe in the main content area).
   * @param domain - Forum domain to activate.
   * @param path - Optional initial path within the forum.
   */
  switchForum(domain: string, path?: string): void {
    const forum = this._forums.find(f => f.domain === domain);
    if (!forum) return;
    this._activeForum = forum;
    this._activePath = path || '';
    this._notify();
  },

  /** Deactivate the current forum and show the home view. */
  goHome(): void {
    this._activeForum = null;
    this._activePath = '';
    this._notify();
  },

  /**
   * Update a forum's unread counts (received from the forum's iframe via postMessage).
   * Recalculates the aggregated `unread` badge count.
   */
  setUnreadCounts(domain: string, counts: ForumUnreadCounts): void {
    this._unreadCounts[domain] = counts;
    const f = this._forums.find(f => f.domain === domain);
    if (f) f.unread = (counts.notifications || 0) + (counts.chat_mentions || 0) + (counts.dms || 0);
    this._notify();
  },

  /** Clear all state (memberships, active forum, cache). Called on sign-out. */
  clear(): void {
    this._accessToken = null;
    this._forums = [];
    this._activeForum = null;
    this._unreadCounts = {};
    try {
      localStorage.removeItem('forumline-memberships');
    } catch {}
    this._notify();
  },
};
