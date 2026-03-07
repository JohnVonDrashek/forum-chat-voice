import { api } from '../lib/api.js'
import { authStore } from '../lib/auth.js'
import { avatarHTML } from '../components/avatar.js'
import { formatRelativeTime } from '../lib/date.js'
import { toast } from '../lib/toast.js'
import { connectSSE } from '../lib/sse.js'

const POSTS_PER_PAGE = 5

export function renderThread(container, { threadId }) {
  container.innerHTML = '<div class="skeleton" style="height:30px;margin-bottom:8px"></div><div class="skeleton" style="height:100px"></div>'

  let currentPage = 1
  let replyingTo = null
  let sseCleanup = null
  let pendingPosts = []

  Promise.all([
    api.getThread(threadId),
    api.getPosts(threadId),
    authStore.get().user ? api.isBookmarked(threadId).catch(() => false) : Promise.resolve(false),
  ]).then(([thread, posts, isBookmarked]) => {
    if (!thread) {
      container.innerHTML = '<div class="empty-state"><p>Thread not found in the archives.</p></div>'
      return
    }

    let bookmarked = isBookmarked
    const { user } = authStore.get()
    const totalPages = Math.ceil((posts?.length || 0) / POSTS_PER_PAGE)

    function render() {
      const start = (currentPage - 1) * POSTS_PER_PAGE
      const pagePosts = (posts || []).slice(start, start + POSTS_PER_PAGE)

      container.innerHTML = `
        <div class="breadcrumb">
          <a href="/">Home</a><span class="breadcrumb-sep">/</span>
          <a href="/c/${thread.category?.slug || ''}">${escapeHTML(thread.category?.name || '')}</a>
        </div>

        <div class="gothic-box">
          <div class="gothic-box-header" style="display:flex;align-items:center;justify-content:space-between">
            <div class="flex items-center gap-1">
              ${thread.is_pinned ? '<span class="tag tag-pinned">Pinned</span>' : ''}
              ${thread.is_locked ? '<span class="tag tag-locked">Locked</span>' : ''}
              <span>${escapeHTML(thread.title)}</span>
            </div>
            ${user ? `
              <button id="bookmark-btn" style="background:none;border:none;cursor:pointer;color:${bookmarked ? 'var(--accent-gold)' : 'var(--text-muted)'};font-size:14px" title="${bookmarked ? 'Remove bookmark' : 'Bookmark'}">
                ${bookmarked ? '&#9733;' : '&#9734;'}
              </button>
            ` : ''}
          </div>
          <div class="gothic-box-content">
            ${thread.image_url ? `<img src="${thread.image_url}" alt="" style="max-height:200px;margin-bottom:10px;border:1px solid var(--border-main)" />` : ''}
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">
              ${posts?.length || 0} posts &middot; Page ${currentPage} of ${totalPages || 1}
            </div>

            <div id="posts-container">
              ${pagePosts.map(p => postHTML(p, thread, posts, user)).join('')}
            </div>

            ${totalPages > 1 ? `
              <div class="pagination">
                ${currentPage > 1 ? `<button class="page-btn" data-page="${currentPage - 1}">Prev</button>` : ''}
                ${Array.from({ length: totalPages }, (_, i) => i + 1).map(p =>
                  `<button class="page-btn ${p === currentPage ? 'active' : ''}" data-page="${p}">${p}</button>`
                ).join('')}
                ${currentPage < totalPages ? `<button class="page-btn" data-page="${currentPage + 1}">Next</button>` : ''}
              </div>
            ` : ''}

            ${pendingPosts.length > 0 ? `
              <div style="margin:12px 0;padding:8px;border:1px dashed var(--accent-blue);text-align:center">
                <button id="show-new-posts" class="link-pink" style="background:none;border:none;font-family:var(--font-main);font-size:12px;cursor:pointer;color:var(--accent-blue)">${pendingPosts.length} new post${pendingPosts.length > 1 ? 's' : ''} - click to load</button>
              </div>
            ` : ''}

            ${!thread.is_locked ? `
              <div style="margin-top:16px;border-top:1px dashed var(--border-main);padding-top:12px">
                ${user ? `
                  ${replyingTo ? `
                    <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">
                      Replying to ${escapeHTML(replyingTo.author?.display_name || replyingTo.author?.username || '')}
                      <button id="cancel-reply" style="color:var(--accent-red);background:none;border:none;font-family:var(--font-main);cursor:pointer;font-size:11px">[cancel]</button>
                    </div>
                  ` : ''}
                  <textarea id="reply-content" rows="4" placeholder="Write a reply..." class="form-input"></textarea>
                  <div style="margin-top:8px;text-align:right">
                    <button id="post-reply-btn" class="btn btn-primary btn-small">Post Reply</button>
                  </div>
                ` : `<p style="text-align:center;font-size:12px;color:var(--text-muted)"><a href="/login" class="link-pink">Sign in</a> to reply.</p>`}
              </div>
            ` : '<p style="text-align:center;font-size:11px;color:var(--text-muted);margin-top:12px">~ This thread is locked ~</p>'}
          </div>
        </div>
      `

      // Event handlers
      container.querySelectorAll('.page-btn').forEach(btn => {
        btn.addEventListener('click', () => { currentPage = parseInt(btn.dataset.page); render() })
      })

      container.querySelectorAll('.reply-to-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          replyingTo = posts.find(p => p.id === btn.dataset.postId) || null
          render()
          container.querySelector('#reply-content')?.focus()
        })
      })

      const bookmarkBtn = container.querySelector('#bookmark-btn')
      if (bookmarkBtn) {
        bookmarkBtn.addEventListener('click', async () => {
          try {
            if (bookmarked) { await api.removeBookmark(threadId); bookmarked = false }
            else { await api.addBookmark(threadId); bookmarked = true }
            render()
          } catch { toast.error('Failed to update bookmark') }
        })
      }

      const cancelReply = container.querySelector('#cancel-reply')
      if (cancelReply) cancelReply.addEventListener('click', () => { replyingTo = null; render() })

      const postBtn = container.querySelector('#post-reply-btn')
      if (postBtn) {
        postBtn.addEventListener('click', async () => {
          const textarea = container.querySelector('#reply-content')
          const content = textarea?.value?.trim()
          if (!content) return

          postBtn.disabled = true
          postBtn.textContent = 'Posting...'

          try {
            await api.createPost({ thread_id: threadId, author_id: user.id, content, reply_to_id: replyingTo?.id })
            posts = await api.getPosts(threadId)
            currentPage = Math.ceil(posts.length / POSTS_PER_PAGE)
            replyingTo = null
            render()
          } catch {
            toast.error('Failed to post reply')
            postBtn.disabled = false
            postBtn.textContent = 'Post Reply'
          }
        })
      }

      const showNewBtn = container.querySelector('#show-new-posts')
      if (showNewBtn) {
        showNewBtn.addEventListener('click', async () => {
          posts = await api.getPosts(threadId)
          pendingPosts = []
          currentPage = Math.ceil(posts.length / POSTS_PER_PAGE)
          render()
        })
      }
    }

    render()

    sseCleanup = connectSSE(`/api/threads/${threadId}/stream`, (data) => {
      if (data?.type === 'new_post' && data.post) {
        if (!posts.find(p => p.id === data.post.id)) {
          pendingPosts.push(data.post)
          render()
        }
      }
    }, true)
  }).catch(() => {
    container.innerHTML = `
      <div class="empty-state">
        <p style="color:var(--accent-red)">Failed to load thread.</p>
        <button id="retry-thread" class="btn btn-small mt-2">Try again</button>
      </div>
    `
    container.querySelector('#retry-thread')?.addEventListener('click', () => renderThread(container, { threadId }))
  })

  return () => { if (sseCleanup) sseCleanup() }
}

function postHTML(post, thread, allPosts, user) {
  const isOP = post.author_id === thread.author_id
  const replyTo = post.reply_to_id ? allPosts.find(p => p.id === post.reply_to_id) : null

  return `
    <div class="post-card" id="post-${post.id}">
      ${replyTo ? `
        <div class="post-reply-indicator">
          &rarr; Replying to ${escapeHTML(replyTo.author?.display_name || replyTo.author?.username || '')}
        </div>
      ` : ''}
      <div class="post-card-header">
        ${avatarHTML({ avatarUrl: post.author?.avatar_url, size: 28 })}
        <a href="/u/${post.author?.username || ''}" class="post-card-author">${escapeHTML(post.author?.display_name || post.author?.username || 'Unknown')}</a>
        ${isOP ? '<span class="tag tag-op">OP</span>' : ''}
        <span class="post-card-time">${formatRelativeTime(post.created_at)}</span>
      </div>
      <div class="post-card-content">${escapeHTML(post.content)}</div>
      ${user && !thread.is_locked ? `
        <div style="margin-top:6px">
          <button class="reply-to-btn" data-post-id="${post.id}" style="font-size:11px;color:var(--text-muted);background:none;border:none;font-family:var(--font-main);cursor:pointer">[reply]</button>
        </div>
      ` : ''}
    </div>
  `
}

function escapeHTML(str) {
  const div = document.createElement('div')
  div.textContent = str || ''
  return div.innerHTML
}
