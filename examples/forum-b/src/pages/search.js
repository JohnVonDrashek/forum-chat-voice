import { api } from '../lib/api.js'
import { avatarHTML } from '../components/avatar.js'
import { formatRelativeTime } from '../lib/date.js'
import { navigate } from '../router.js'

export function renderSearch(container) {
  let debounceTimer = null
  let filter = 'all'
  let currentQuery = ''
  let threadResults = []
  let postResults = []

  const params = new URLSearchParams(location.search)
  const initialQuery = params.get('q') || ''
  const initialFilter = params.get('filter') || 'all'
  filter = initialFilter

  container.innerHTML = `
    <div class="gothic-box">
      <div class="gothic-box-header">~ Search the Archives ~</div>
      <div class="gothic-box-content">
        <div class="form-group" style="position:relative">
          <input id="search-input" type="text" placeholder="Search threads and posts..." value="${escapeAttr(initialQuery)}" class="form-input" autofocus />
        </div>
        <div id="search-filters" class="hidden tab-bar">
          <button class="tab-btn ${filter === 'all' ? 'active' : ''}" data-filter="all">All</button>
          <button class="tab-btn ${filter === 'threads' ? 'active' : ''}" data-filter="threads">Threads <span id="thread-count"></span></button>
          <button class="tab-btn ${filter === 'posts' ? 'active' : ''}" data-filter="posts">Posts <span id="post-count"></span></button>
        </div>
        <div id="search-results">
          ${!initialQuery ? emptyStateHTML() : ''}
        </div>
      </div>
    </div>
  `

  const input = container.querySelector('#search-input')
  const filtersEl = container.querySelector('#search-filters')

  if (initialQuery) doSearch(initialQuery)

  function updateURL(q) {
    const p = new URLSearchParams()
    if (q) { p.set('q', q); p.set('filter', filter) }
    const newUrl = p.toString() ? `${location.pathname}?${p}` : location.pathname
    history.replaceState(null, '', newUrl)
  }

  input.addEventListener('input', () => {
    const q = input.value.trim()
    clearTimeout(debounceTimer)
    if (!q) {
      currentQuery = ''
      updateURL('')
      container.querySelector('#search-results').innerHTML = emptyStateHTML()
      filtersEl.classList.add('hidden')
      return
    }
    debounceTimer = setTimeout(() => doSearch(q), 300)
  })

  container.addEventListener('click', (e) => {
    const suggBtn = e.target.closest('.suggest-btn')
    if (suggBtn) {
      input.value = suggBtn.dataset.term
      doSearch(suggBtn.dataset.term)
    }
  })

  container.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      filter = btn.dataset.filter
      updateURL(currentQuery)
      container.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.filter === filter)
      })
      renderResults()
    })
  })

  async function doSearch(query) {
    currentQuery = query
    updateURL(query)
    container.querySelector('#search-results').innerHTML = '<div class="skeleton" style="height:60px"></div>'
    try {
      [threadResults, postResults] = await Promise.all([
        api.searchThreads(query).catch(() => []),
        api.searchPosts(query).catch(() => []),
      ])
      filtersEl.classList.remove('hidden')
      container.querySelector('#thread-count').textContent = `(${threadResults.length})`
      container.querySelector('#post-count').textContent = `(${postResults.length})`
      renderResults()
    } catch {
      container.querySelector('#search-results').innerHTML = '<div class="empty-state"><p style="color:var(--accent-red)">Search failed.</p></div>'
    }
  }

  function renderResults() {
    const resultsEl = container.querySelector('#search-results')
    const threads = filter !== 'posts' ? threadResults : []
    const posts = filter !== 'threads' ? postResults : []

    if (!threads.length && !posts.length) {
      resultsEl.innerHTML = `<div class="empty-state"><p>No results for "${escapeHTML(currentQuery)}"</p><p style="font-size:12px">Try different keywords.</p></div>`
      return
    }

    let html = ''
    if (threads.length) {
      html += threads.map(t => `
        <a href="/t/${t.id}" class="thread-card">
          <span class="tag tag-thread">Thread</span>
          <div class="min-w-0" style="flex:1">
            <div class="thread-card-title">${highlightMatch(escapeHTML(t.title), currentQuery)}</div>
            <div class="thread-card-meta">${escapeHTML(t.author?.display_name || '')} &middot; ${formatRelativeTime(t.created_at)} &middot; ${t.post_count || 0} replies</div>
          </div>
        </a>
      `).join('')
    }
    if (posts.length) {
      html += posts.map(p => `
        <a href="/t/${p.thread_id}#post-${p.id}" class="thread-card">
          <span class="tag tag-post">Post</span>
          <div class="min-w-0" style="flex:1">
            <div style="font-size:12px;margin-bottom:2px"><strong>${escapeHTML(p.author?.display_name || '')}</strong> <span style="color:var(--text-muted)">${formatRelativeTime(p.created_at)}</span></div>
            <div style="font-size:12px;color:var(--text-main)">${highlightMatch(escapeHTML(p.content), currentQuery)}</div>
          </div>
        </a>
      `).join('')
    }
    resultsEl.innerHTML = html
  }
}

function emptyStateHTML() {
  return `
    <div class="empty-state">
      <p style="font-size:14px;color:var(--accent-pink)">Search the forum</p>
      <p style="font-size:12px">Start typing to see results instantly.</p>
      <div style="margin-top:12px">
        <p style="font-size:10px;color:var(--text-muted);margin-bottom:6px">Try searching for:</p>
        <div class="flex flex-wrap gap-1" style="justify-content:center">
          ${['welcome', 'voice', 'features', 'admin'].map(t => `<button class="suggest-btn btn btn-small" data-term="${t}">${t}</button>`).join('')}
        </div>
      </div>
    </div>
  `
}

function highlightMatch(text, query) {
  if (!query.trim()) return text
  try {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return text.replace(new RegExp(`(${escaped})`, 'gi'), '<span class="search-highlight">$1</span>')
  } catch { return text }
}

function escapeHTML(str) {
  const div = document.createElement('div')
  div.textContent = str || ''
  return div.innerHTML
}

function escapeAttr(str) {
  return (str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
