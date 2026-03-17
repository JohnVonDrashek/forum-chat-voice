import { avatarUrl } from '../lib/avatar.js';
import { escapeHtml, renderMarkdown } from '../lib/markdown.js';
import { $, plural } from '../lib/utils.js';
import * as data from '../state/data.js';
import store from '../state/store.js';

let _showView, _showToast, _showForum, _showHome, _addBookmark, _removeBookmark, _bookmarks;

let newReplyTimer = null;
let newReplyAutoHideTimer = null;
let attachedImageData = null;

export function showThread(threadId) {
  const allThreads = Object.values(data.threads).flat();
  const thread = allThreads.find(t => t.id === threadId);
  if (!thread) {
    _showToast('Thread not found');
    _removeBookmark(threadId);
    return;
  }

  // Clear any attached image
  attachedImageData = null;
  $('imagePreviewBar')?.classList.add('hidden');

  store.currentView = 'thread';
  store.currentThread = threadId;
  store.currentDm = null;
  $('threadTitle').textContent = thread.title;

  // Update breadcrumbs
  const allThreadsFlat = Object.entries(data.threads).flatMap(([fid, ts]) =>
    ts.map(t => ({ ...t, forumId: fid })),
  );
  const threadWithForum = allThreadsFlat.find(t => t.id === threadId);
  if (threadWithForum) {
    const forum = data.forums.find(f => f.id === threadWithForum.forumId);
    if (forum) {
      $('breadcrumbForum').textContent = forum.name;
      $('breadcrumbForum').dataset.nav = 'forum';
      store.currentForum = threadWithForum.forumId;
    }
    $('breadcrumbThread').textContent = threadWithForum.title;
  }

  // Clear any quote
  $('quotePreview').classList.add('hidden');

  // Show view with skeleton loading
  $('newRepliesToast')?.classList.add('hidden');
  const postsList = $('postsList');
  showSkeletons(postsList, 3);
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $('threadView').classList.remove('hidden');
  setTimeout(() => {
    if (store.currentThread) renderPosts(store.currentThread);
  }, 250);

  // Render thread presence
  renderThreadPresence(threadId);

  // Simulate "new replies" toast after 8 seconds
  clearTimeout(newReplyTimer);
  clearTimeout(newReplyAutoHideTimer);
  newReplyTimer = setTimeout(() => {
    if (store.currentView === 'thread' && store.currentThread === threadId) {
      const toast = $('newRepliesToast');
      toast.classList.remove('hidden');
      toast.onclick = () => {
        toast.classList.add('hidden');
        clearTimeout(newReplyAutoHideTimer);
        $('postsList').scrollTop = $('postsList').scrollHeight;
      };
      // Auto-hide after 5s
      newReplyAutoHideTimer = setTimeout(() => toast.classList.add('hidden'), 5000);
    }
  }, 8000);
}

function showSkeletons(container, count) {
  let html = '';
  for (let i = 0; i < count; i++) {
    html += `
      <div class="skeleton-thread">
        <div class="skeleton skeleton-circle"></div>
        <div class="skeleton-lines">
          <div class="skeleton skeleton-line skeleton-line-long"></div>
          <div class="skeleton skeleton-line skeleton-line-short"></div>
        </div>
      </div>
    `;
  }
  container.innerHTML = html;
}

/**
 * Composed renderPosts -- merges all monkey-patched layers:
 * 1. Base posts with markdown, reactions, quote buttons
 * 2. Link previews
 * 3. Image galleries
 * 4. Bookmark buttons
 * 5. Polls
 * 6. Role badges and achievement badges
 */
export function renderPosts(threadId) {
  const el = $('postsList');
  const threadPosts = data.posts[threadId] || [];
  const bookmarks = _bookmarks();

  el.innerHTML = threadPosts
    .map((p, i) => {
      const quoteHtml = p.quote ? `<div class="post-quote">${p.quote}</div>` : '';
      const contentHtml = p.content
        ? `<div class="post-content">${renderMarkdown(p.content)}</div>`
        : '';
      const imageHtml = p.image
        ? `<div class="post-image-gallery"><img class="post-image-thumb" src="${p.image}" alt="Attached image"></div>`
        : '';

      return `
      <div class="post-item" role="listitem">
        <img class="post-avatar" src="${avatarUrl(p.seed)}" alt="${p.author}'s avatar" onerror="this.style.display='none'">
        <div class="post-body">
          <div class="post-author">${p.author} <span class="post-time">${p.time}</span></div>
          ${quoteHtml}
          ${contentHtml}
          ${imageHtml}
          <div class="post-footer">
            ${Object.entries(p.reactions || {})
              .map(
                ([emoji, d]) =>
                  `<button class="reaction-btn ${d.active ? 'active' : ''}" data-post="${i}" data-emoji="${emoji}" aria-label="React with ${emoji}, ${d.count} reactions" aria-pressed="${d.active}">
                <span class="reaction-emoji">${emoji}</span>
                <span class="reaction-count">${d.count}</span>
              </button>`,
              )
              .join('')}
            <button class="add-reaction-btn" data-post="${i}" title="Add reaction" aria-label="Add reaction">+</button>
            <button class="post-quote-btn" data-post="${i}" title="Quote reply" aria-label="Quote and reply">&#x21A9; Reply</button>
          </div>
        </div>
      </div>
    `;
    })
    .join('');

  // --- Bind reaction clicks ---
  el.querySelectorAll('.reaction-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('active');
      const countEl = btn.querySelector('.reaction-count');
      let count = parseInt(countEl.textContent);
      if (btn.classList.contains('active')) {
        countEl.textContent = count + 1;
      } else {
        countEl.textContent = Math.max(0, count - 1);
      }
      const emoji = btn.querySelector('.reaction-emoji');
      emoji.style.transform = 'scale(1.4)';
      setTimeout(() => (emoji.style.transform = ''), 200);
    });
  });

  // --- Quote reply buttons ---
  el.querySelectorAll('.post-quote-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const postIdx = parseInt(btn.dataset.post);
      const post = threadPosts[postIdx];
      if (post) {
        const quoteText = post.content.substring(0, 100) + (post.content.length > 100 ? '...' : '');
        $('quotePreviewText').textContent = `${post.author}: "${quoteText}"`;
        $('quotePreview').classList.remove('hidden');
        $('quotePreview').dataset.author = post.author;
        $('quotePreview').dataset.text = quoteText;
        $('replyInput').focus();
      }
    });
  });

  // --- Insert link previews ---
  const preview = data.linkPreviews[threadId];
  if (preview) {
    const postItems = el.querySelectorAll('.post-item');
    if (postItems && postItems[preview.postIndex]) {
      const postBody = postItems[preview.postIndex].querySelector('.post-body');
      const previewEl = document.createElement('div');
      previewEl.className = 'link-preview';
      previewEl.innerHTML = `
        <div class="link-preview-image" style="background: ${preview.color}; display: flex; align-items: center; justify-content: center; color: white; font-weight: 700; font-size: 20px;">${preview.domain.charAt(0).toUpperCase()}</div>
        <div class="link-preview-info">
          <div class="link-preview-domain">${preview.domain}</div>
          <div class="link-preview-title">${preview.title}</div>
          <div class="link-preview-desc">${preview.desc}</div>
        </div>
      `;
      const footer = postBody.querySelector('.post-footer');
      postBody.insertBefore(previewEl, footer);
    }
  }

  // --- Add image galleries ---
  const imgData = data.postImages[threadId];
  if (imgData) {
    const postItems = el.querySelectorAll('.post-item');
    if (postItems && postItems[0]) {
      const postBody = postItems[0].querySelector('.post-body');
      const content = postBody.querySelector('.post-content');
      const gallery = document.createElement('div');
      gallery.className = 'post-image-gallery';
      imgData.forEach((_, i) => {
        const img = document.createElement('img');
        img.className = 'post-image-thumb';
        img.src = `https://picsum.photos/seed/${threadId}${i}/240/180`;
        img.alt = 'Post image';
        img.addEventListener('click', () => openLightbox(img.src.replace('/240/180', '/800/600')));
        gallery.appendChild(img);
      });
      if (content) content.after(gallery);
    }
  }

  // --- Add bookmark buttons to all posts ---
  const allPostItems = el.querySelectorAll('.post-item');
  allPostItems.forEach((item, idx) => {
    const footer = item.querySelector('.post-footer');
    if (footer) {
      const isBookmarked = bookmarks.find(b => b.threadId === store.currentThread);
      const bookmarkBtn = document.createElement('button');
      bookmarkBtn.className = `post-bookmark-btn ${isBookmarked && idx === 0 ? 'bookmarked' : ''}`;
      bookmarkBtn.innerHTML = isBookmarked && idx === 0 ? '&#x2605;' : '&#x2606;';
      bookmarkBtn.title = 'Bookmark';
      bookmarkBtn.addEventListener('click', () => {
        if (bookmarkBtn.classList.contains('bookmarked')) {
          bookmarkBtn.classList.remove('bookmarked');
          bookmarkBtn.innerHTML = '&#x2606;';
          _removeBookmark(store.currentThread);
        } else {
          bookmarkBtn.classList.add('bookmarked');
          bookmarkBtn.innerHTML = '&#x2605;';
          const thread = Object.values(data.threads)
            .flat()
            .find(t => t.id === store.currentThread);
          _addBookmark(store.currentThread, thread?.title || 'Untitled');
        }
      });
      footer.appendChild(bookmarkBtn);
    }
  });

  // --- Add polls ---
  const poll = data.pollData[threadId];
  if (poll) {
    const postItems = el.querySelectorAll('.post-item');
    if (postItems && postItems[0]) {
      const postBody = postItems[0].querySelector('.post-body');
      const content = postBody.querySelector('.post-content');
      const pollEl = document.createElement('div');
      pollEl.className = 'poll-container' + (poll.userVoted !== null ? ' poll-voted' : '');
      pollEl.innerHTML = `
        <div class="poll-question">${poll.question}</div>
        ${poll.options
          .map((opt, i) => {
            const pct = Math.round((opt.votes / poll.totalVotes) * 100);
            const isVoted = poll.userVoted === i;
            return `
            <div class="poll-option ${isVoted ? 'voted' : ''}" data-idx="${i}">
              <div class="poll-option-bar" style="width: ${poll.userVoted !== null ? pct : 0}%"></div>
              <div class="poll-option-check"></div>
              <span class="poll-option-text">${opt.text}</span>
              <span class="poll-option-percent">${pct}%</span>
            </div>
          `;
          })
          .join('')}
        <div class="poll-meta">
          <span>${poll.totalVotes} votes</span>
          <span>${poll.userVoted !== null ? 'You voted' : 'Click to vote'}</span>
        </div>
      `;
      if (content) content.after(pollEl);

      // Bind poll votes
      pollEl.querySelectorAll('.poll-option').forEach(opt => {
        opt.addEventListener('click', () => {
          if (poll.userVoted !== null) return;
          const idx = parseInt(opt.dataset.idx);
          poll.userVoted = idx;
          poll.options[idx].votes++;
          poll.totalVotes++;

          pollEl.classList.add('poll-voted');
          opt.classList.add('voted');

          pollEl.querySelectorAll('.poll-option').forEach((o, i) => {
            const pct = Math.round((poll.options[i].votes / poll.totalVotes) * 100);
            o.querySelector('.poll-option-bar').style.width = pct + '%';
            o.querySelector('.poll-option-percent').textContent = pct + '%';
          });

          pollEl.querySelector('.poll-meta').innerHTML =
            `<span>${poll.totalVotes} votes</span><span>You voted</span>`;
        });
      });
    }
  }

  // --- Add role badges and achievement badges ---
  if (store.currentForum) {
    const members = data.forumMembers[store.currentForum] || [];
    const postItemsForBadges = el.querySelectorAll('.post-item');
    postItemsForBadges.forEach(item => {
      const authorEl = item.querySelector('.post-author');
      if (authorEl) {
        const name = authorEl.textContent.split(' ')[0].trim();
        const member = members.find(m => m.name === name);
        if (member && member.role !== 'Member') {
          const badge = document.createElement('span');
          badge.className = `post-role-badge post-role-${member.role.toLowerCase()}`;
          badge.textContent = member.role;
          const timeSpan = authorEl.querySelector('.post-time');
          if (timeSpan) authorEl.insertBefore(badge, timeSpan);
          else authorEl.appendChild(badge);
        }

        // Add achievement badges inline
        const badges = data.userBadges[name] || [];
        if (badges.length > 0) {
          const first = data.badgeDefinitions.find(d => d.id === badges[0]);
          if (first) {
            const inlineBadge = document.createElement('span');
            inlineBadge.className = 'badge-inline';
            inlineBadge.innerHTML = first.icon;
            inlineBadge.title = first.name;
            const timeSpan = authorEl.querySelector('.post-time');
            if (timeSpan) authorEl.insertBefore(inlineBadge, timeSpan);
          }
        }
      }
    });
  }
}

function openLightbox(src) {
  $('lightboxImg').src = src;
  $('lightbox').classList.remove('hidden');
}

export function renderThreadPresence(threadId) {
  const viewers = data.threadViewers[threadId] || [];
  const bar = $('threadPresence');
  if (!bar) return;

  if (viewers.length === 0) {
    bar.style.display = 'none';
    return;
  }
  bar.style.display = 'flex';

  $('presenceAvatars').innerHTML = viewers
    .slice(0, 4)
    .map(v => `<img src="${avatarUrl(v.seed)}" alt="${v.name}" title="${v.name}">`)
    .join('');

  const names = viewers.map(v => v.name);
  let text;
  if (names.length === 1) text = `${names[0]} is viewing`;
  else if (names.length === 2) text = `${names[0]} and ${names[1]} are viewing`;
  else text = `${names[0]} and ${names.length - 1} others are viewing`;
  $('presenceText').textContent = text;
}

export function initThread(deps) {
  _showView = deps.showView;
  _showToast = deps.showToast;
  _showForum = deps.showForum;
  _showHome = deps.showHome;
  _addBookmark = deps.addBookmark;
  _removeBookmark = deps.removeBookmark;
  _bookmarks = deps.getBookmarks;

  // Reply button handler (with quote and image attachment support)
  const replyBtn = $('replyBtn');
  replyBtn?.addEventListener('click', () => {
    const input = $('replyInput');
    if ((input.value.trim() || attachedImageData) && store.currentThread) {
      // Build quote data before clearing
      let quoteContent = null;
      const quotePreview = $('quotePreview');
      if (!quotePreview.classList.contains('hidden')) {
        const quoteAuthor = quotePreview.dataset.author;
        const quoteText = quotePreview.dataset.text;
        quoteContent = `${quoteAuthor}: "${quoteText}"`;
        quotePreview.classList.add('hidden');
      }

      // Persist to data structure so replies survive navigation
      const newPostData = {
        author: 'testcaller',
        seed: 'testcaller',
        time: 'just now',
        content: input.value.trim(),
        reactions: {},
      };
      if (quoteContent) newPostData.quote = quoteContent;
      if (attachedImageData) newPostData.image = attachedImageData;
      if (!data.posts[store.currentThread]) data.posts[store.currentThread] = [];
      data.posts[store.currentThread].push(newPostData);

      // Increment reply count on the thread
      const allThreadsFlat = Object.values(data.threads).flat();
      const thread = allThreadsFlat.find(t => t.id === store.currentThread);
      if (thread) thread.replies++;

      const postsList = $('postsList');
      const newPost = document.createElement('div');
      newPost.className = 'post-item';
      newPost.style.animation = 'viewFadeSlide 0.3s ease-out';

      let imageHtml = '';
      if (attachedImageData) {
        imageHtml = `<div class="post-image-gallery"><img class="post-image-thumb" src="${attachedImageData}" alt="Attached image"></div>`;
      }

      let quoteHtml = quoteContent ? `<div class="post-quote">${quoteContent}</div>` : '';
      let contentHtml = input.value.trim()
        ? `<div class="post-content">${renderMarkdown(input.value)}</div>`
        : '';
      const newPostIndex = data.posts[store.currentThread].length - 1;

      newPost.innerHTML = `
        <img class="post-avatar" src="${avatarUrl('testcaller')}" alt="">
        <div class="post-body">
          <div class="post-author">testcaller <span class="badge-inline" title="Early Adopter">&#x2B50;</span><span class="post-time">just now</span></div>
          ${quoteHtml}
          ${contentHtml}
          ${imageHtml}
          <div class="post-footer">
            <button class="add-reaction-btn" data-post="${newPostIndex}" title="Add reaction">+</button>
            <button class="post-quote-btn" data-post="${newPostIndex}" title="Quote reply">&#x21A9; Reply</button>
            <button class="post-bookmark-btn" title="Bookmark">&#x2606;</button>
          </div>
        </div>
      `;
      postsList.appendChild(newPost);

      // Bind quote reply button on the new post
      const quoteBtn = newPost.querySelector('.post-quote-btn');
      if (quoteBtn) {
        quoteBtn.addEventListener('click', () => {
          const postIdx = parseInt(quoteBtn.dataset.post);
          const threadPosts = data.posts[store.currentThread] || [];
          const post = threadPosts[postIdx];
          if (post) {
            const qt = post.content.substring(0, 100) + (post.content.length > 100 ? '...' : '');
            $('quotePreviewText').textContent = `${post.author}: "${qt}"`;
            $('quotePreview').classList.remove('hidden');
            $('quotePreview').dataset.author = post.author;
            $('quotePreview').dataset.text = qt;
            $('replyInput').focus();
          }
        });
      }

      input.value = '';
      input.style.height = '38px';
      attachedImageData = null;
      $('imagePreviewBar')?.classList.add('hidden');
      postsList.scrollTop = postsList.scrollHeight;
    }
  });

  // Enter key to send reply
  $('replyInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      replyBtn?.click();
    }
  });

  // Image drop zone handlers
  const replyInput = $('replyInput');
  const dropZone = $('imageDropZone');
  const previewBar = $('imagePreviewBar');
  const previewThumb = $('imagePreviewThumb');

  replyInput?.addEventListener('dragenter', e => {
    e.preventDefault();
    dropZone?.classList.remove('hidden');
    dropZone?.classList.add('dragover');
  });

  dropZone?.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone?.addEventListener('dragleave', e => {
    if (!dropZone.contains(e.relatedTarget)) {
      dropZone.classList.remove('dragover');
      if (!attachedImageData) dropZone.classList.add('hidden');
    }
  });

  dropZone?.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    dropZone.classList.add('hidden');
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type.startsWith('image/')) {
      handleImageAttach(file, previewThumb, previewBar, dropZone);
    }
  });

  $('imageFileInput')?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) handleImageAttach(file, previewThumb, previewBar, dropZone);
  });

  $('imagePreviewRemove')?.addEventListener('click', () => {
    attachedImageData = null;
    previewBar?.classList.add('hidden');
  });

  // Quote remove handler
  $('quoteRemove').addEventListener('click', () => {
    $('quotePreview').classList.add('hidden');
  });
}

function handleImageAttach(file, previewThumb, previewBar, dropZone) {
  const reader = new FileReader();
  reader.onload = e => {
    attachedImageData = e.target.result;
    previewThumb.style.backgroundImage = `url(${attachedImageData})`;
    previewBar?.classList.remove('hidden');
    dropZone?.classList.add('hidden');
  };
  reader.readAsDataURL(file);
}
