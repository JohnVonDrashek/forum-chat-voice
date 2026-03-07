import { api } from '../lib/api.js'
import { authStore, getAccessToken } from '../lib/auth.js'
import { uploadAvatar, uploadDefaultAvatar } from '../lib/avatars.js'
import { navigate } from '../router.js'
import { showCropModal } from '../components/image-crop-modal.js'

export function renderNewThread(container, { categorySlug }) {
  const { user } = authStore.get()
  if (!user) {
    container.innerHTML = '<div class="empty-state"><p><a href="/login" class="link-pink">Sign in</a> to create a thread.</p></div>'
    return
  }

  container.innerHTML = '<div class="skeleton" style="height:30px"></div>'

  api.getCategory(categorySlug).then(category => {
    if (!category) {
      container.innerHTML = '<div class="empty-state"><p>Category not found.</p></div>'
      return
    }

    let imageFile = null

    container.innerHTML = `
      <div class="breadcrumb">
        <a href="/">Home</a><span class="breadcrumb-sep">/</span>
        <a href="/c/${categorySlug}">${escapeHTML(category.name)}</a><span class="breadcrumb-sep">/</span>
        <span style="color:var(--text-main)">New Thread</span>
      </div>

      <div class="gothic-box">
        <div class="gothic-box-header">~ New Thread in ${escapeHTML(category.name)} ~</div>
        <div class="gothic-box-content">
          <form id="new-thread-form">
            <div class="form-group">
              <label class="form-label">Thread Image (optional)</label>
              <input type="file" id="thread-image" accept="image/*" style="font-size:12px;color:var(--text-muted)" />
              <div id="image-preview" class="hidden" style="margin-top:6px"></div>
            </div>
            <div class="form-group">
              <label class="form-label">Title</label>
              <input type="text" name="title" required minlength="5" class="form-input" placeholder="Thread title" />
            </div>
            <div class="form-group">
              <label class="form-label">Content</label>
              <textarea name="content" required minlength="10" rows="8" class="form-input" placeholder="Write your post..."></textarea>
            </div>
            <div id="thread-error" class="form-error"></div>
            <div class="flex items-center gap-2">
              <a href="/c/${categorySlug}" class="btn btn-small">Cancel</a>
              <button type="submit" class="btn btn-primary btn-small">Create Thread</button>
            </div>
          </form>
        </div>
      </div>
    `

    const fileInput = container.querySelector('#thread-image')
    const preview = container.querySelector('#image-preview')
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0]
      if (!file) return
      fileInput.value = ''

      const imageSrc = URL.createObjectURL(file)
      const blob = await showCropModal(imageSrc)
      URL.revokeObjectURL(imageSrc)
      if (!blob) return

      imageFile = blob
      preview.innerHTML = `<img src="${URL.createObjectURL(blob)}" style="height:100px;border:1px solid var(--border-main)" />`
      preview.classList.remove('hidden')
    })

    container.querySelector('#new-thread-form').addEventListener('submit', async (e) => {
      e.preventDefault()
      const form = e.target
      const errorEl = container.querySelector('#thread-error')
      const btn = form.querySelector('button[type=submit]')

      btn.disabled = true
      btn.textContent = 'Creating...'
      errorEl.classList.remove('visible')

      try {
        const title = form.title.value.trim()
        const content = form.content.value.trim()
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

        const result = await api.createThread({ category_id: category.id, author_id: user.id, title, slug })
        if (!result?.id) throw new Error('Failed to create thread')

        await api.createPost({ thread_id: result.id, author_id: user.id, content })

        const token = await getAccessToken()
        if (imageFile && token) {
          const imageUrl = await uploadAvatar(imageFile, `thread/${result.id}/image.png`, token)
          if (imageUrl) await api.updateThread(result.id, { image_url: imageUrl })
        } else if (token) {
          const imageUrl = await uploadDefaultAvatar(result.id, 'thread', token)
          if (imageUrl) await api.updateThread(result.id, { image_url: imageUrl })
        }

        navigate(`/t/${result.id}`)
      } catch (err) {
        errorEl.textContent = err.message || 'Failed to create thread'
        errorEl.classList.add('visible')
        btn.disabled = false
        btn.textContent = 'Create Thread'
      }
    })
  })
}

function escapeHTML(str) {
  const div = document.createElement('div')
  div.textContent = str || ''
  return div.innerHTML
}
