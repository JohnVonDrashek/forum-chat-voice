/**
 * @module forum-discovery
 *
 * Public APIs for searching, browsing, and registering forums on the Forumline network.
 * No authentication required for search/tags — registration and management need a token.
 *
 * @example
 * ```ts
 * const results = await ForumDiscoveryAPI.searchForums({ query: 'gaming', sort: 'popular' });
 * const tags = await ForumDiscoveryAPI.fetchTags();
 * ```
 */

/** Options for {@link ForumDiscoveryAPI.searchForums}. */
export interface ForumSearchOptions {
  /** Full-text search query. */
  query?: string;
  /** Filter by a specific tag (e.g. `"gaming"`, `"programming"`). */
  tag?: string;
  /** Sort order: `"popular"` (default), `"newest"`, `"alphabetical"`. */
  sort?: string;
  /** Max results to return (default 20). */
  limit?: number;
  /** Pagination offset. */
  offset?: number;
}

/** A forum returned by search or listing endpoints. */
export interface ForumSearchResult {
  /** Forum's canonical domain (e.g. `"my-forum.forumline.net"`). */
  domain: string;
  /** Human-readable forum name. */
  name: string;
  /** Short description. */
  description?: string;
  /** Forum icon URL. */
  icon_url?: string;
  /** Approximate member count. */
  member_count?: number;
  /** Categorization tags. */
  tags?: string[];
  [key: string]: unknown;
}

/** Data required to register a new forum on the Forumline network. */
export interface ForumRegistrationData {
  /** Forum display name. */
  name: string;
  /** Desired subdomain (e.g. `"my-forum"` → `my-forum.forumline.net`). */
  domain: string;
  /** Optional description. */
  description?: string;
  /** Optional categorization tags. */
  tags?: string[];
  [key: string]: unknown;
}

/**
 * Public forum discovery API. Search forums, browse tags, and get recommendations.
 * Uses generation counters to discard stale responses from superseded requests.
 */
export const ForumDiscoveryAPI = {
  _fetchGen: 0,
  _recGen: 0,

  /**
   * Search for forums by query, tag, and sort order.
   * Returns `null` if the request was superseded by a newer search.
   */
  async searchForums(opts?: ForumSearchOptions): Promise<ForumSearchResult[] | null> {
    const o = opts || {};
    const gen = ++this._fetchGen;
    const params = new URLSearchParams();
    if (o.query) params.set('q', o.query);
    if (o.tag) params.set('tag', o.tag);
    params.set('sort', o.sort || 'popular');
    params.set('limit', String(o.limit || 20));
    if (o.offset) params.set('offset', String(o.offset));
    try {
      const res = await fetch('/api/forums?' + params);
      if (res.ok && gen === this._fetchGen) return await res.json();
    } catch (e) {
      console.error('[Discovery] search fetch failed:', e);
    }
    return null;
  },

  /** Fetch all available forum tags for filtering/browsing. */
  async fetchTags(): Promise<string[]> {
    try {
      const r = await fetch('/api/forums/tags');
      if (r.ok) return await r.json();
    } catch (e) {
      console.error('[Discovery] tags fetch failed:', e);
    }
    return [];
  },

  /**
   * Fetch personalized forum recommendations for the authenticated user.
   * @param accessToken - Current user's access token.
   * @returns Recommended forums, or empty array if not authenticated.
   */
  async fetchRecommended(accessToken: string): Promise<ForumSearchResult[]> {
    if (!accessToken) return [];
    const gen = ++this._recGen;
    try {
      const r = await fetch('/api/forums/recommended', {
        headers: { Authorization: 'Bearer ' + accessToken },
      });
      if (r.ok && gen === this._recGen) return await r.json();
    } catch (e) {
      console.error('[Discovery] recommended fetch failed:', e);
    }
    return [];
  },
};

/**
 * Forum registration and management API. Requires authentication.
 */
export const ForumRegistrationAPI = {
  /**
   * Register a new forum on the Forumline network.
   * @param data - Forum name, domain, and optional metadata.
   * @param accessToken - Current user's access token.
   * @throws {Error} If registration fails (domain taken, validation error, etc.).
   */
  async registerForum(
    data: ForumRegistrationData,
    accessToken: string,
  ): Promise<ForumSearchResult> {
    const r = await fetch('/api/forums', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + accessToken },
      body: JSON.stringify(data),
    });
    if (!r.ok) throw new Error('Registration failed: ' + r.status);
    return await r.json();
  },

  /**
   * List all forums owned by the current user.
   * @param accessToken - Current user's access token.
   */
  async listOwnedForums(accessToken: string): Promise<ForumSearchResult[]> {
    try {
      const r = await fetch('/api/forums/owned', {
        headers: { Authorization: 'Bearer ' + accessToken },
      });
      if (!r.ok) return [];
      return await r.json();
    } catch {
      return [];
    }
  },

  /**
   * Delete a forum you own. This is irreversible.
   * @param forumDomain - Domain of the forum to delete.
   * @param accessToken - Current user's access token.
   * @throws {Error} If deletion fails (not owner, not found, etc.).
   */
  async deleteForum(forumDomain: string, accessToken: string): Promise<void> {
    const r = await fetch('/api/forums', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + accessToken },
      body: JSON.stringify({ forum_domain: forumDomain }),
    });
    if (!r.ok) throw new Error('Delete failed: ' + r.status);
  },
};
