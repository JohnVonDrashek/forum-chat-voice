// ========== FORUM DISCOVERY & REGISTRATION API ==========
// Forum search, tags, recommendations, registration, and management.

export const ForumDiscoveryAPI = {
  _fetchGen: 0,
  _recGen: 0,

  async searchForums(opts) {
    opts = opts || {};
    var gen = ++this._fetchGen;
    var params = new URLSearchParams();
    if (opts.query) params.set('q', opts.query);
    if (opts.tag) params.set('tag', opts.tag);
    params.set('sort', opts.sort || 'popular');
    params.set('limit', String(opts.limit || 20));
    if (opts.offset) params.set('offset', String(opts.offset));
    try {
      var res = await fetch('/api/forums?' + params);
      if (res.ok && gen === this._fetchGen) return await res.json();
    } catch (e) {}
    return null;
  },

  async fetchTags() {
    try {
      var r = await fetch('/api/forums/tags');
      if (r.ok) return await r.json();
    } catch (e) {}
    return [];
  },

  async fetchRecommended(accessToken) {
    if (!accessToken) return [];
    var gen = ++this._recGen;
    try {
      var r = await fetch('/api/forums/recommended', { headers: { Authorization: 'Bearer ' + accessToken } });
      if (r.ok && gen === this._recGen) return await r.json();
    } catch (e) {}
    return [];
  },
};

export const ForumRegistrationAPI = {
  async registerForum(data, accessToken) {
    var r = await fetch('/api/forums', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + accessToken },
      body: JSON.stringify(data),
    });
    if (!r.ok) throw new Error('Registration failed: ' + r.status);
    return await r.json();
  },

  async listOwnedForums(accessToken) {
    try {
      var r = await fetch('/api/forums/owned', { headers: { Authorization: 'Bearer ' + accessToken } });
      if (!r.ok) return [];
      return await r.json();
    } catch (e) { return []; }
  },

  async deleteForum(forumDomain, accessToken) {
    var r = await fetch('/api/forums', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + accessToken },
      body: JSON.stringify({ forum_domain: forumDomain }),
    });
    if (!r.ok) throw new Error('Delete failed: ' + r.status);
  },
};
