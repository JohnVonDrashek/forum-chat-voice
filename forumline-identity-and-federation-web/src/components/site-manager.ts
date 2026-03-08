import type { GoTrueAuthClient } from '../lib/gotrue-auth.js'
import { createButton, createInput, createCard, createSpinner, showToast } from './ui.js'

interface SiteManagerOptions {
  slug: string
  forumName: string
  domain: string
  auth: GoTrueAuthClient
  onClose: () => void
}

interface SiteFile {
  size: number
  content_type: string
  etag: string
  updated: string
}

interface SiteManifest {
  files: Record<string, SiteFile>
  updated: string
  storage_bytes: number
  storage_limit: number
}

const TEXT_EXTENSIONS = new Set(['.html', '.css', '.js', '.json', '.txt', '.xml', '.svg'])

function isTextFile(name: string): boolean {
  const ext = name.lastIndexOf('.')
  if (ext === -1) return false
  return TEXT_EXTENSIONS.has(name.slice(ext))
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const val = bytes / Math.pow(1024, i)
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function fileIcon(name: string): string {
  const ext = name.slice(name.lastIndexOf('.'))
  const icons: Record<string, string> = {
    '.html': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    '.css': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    '.js': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  }
  return `<svg class="icon-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons[ext] || icons['.html']}</svg>`
}

export function createSiteManager({ slug, forumName, domain, auth, onClose }: SiteManagerOptions) {
  let manifest: SiteManifest | null = null
  let editingFile: string | null = null
  let editingContent: string | null = null
  let loading = true

  const el = document.createElement('div')
  el.className = 'page-scroll'

  // Header
  const header = document.createElement('div')
  header.className = 'settings-header'
  const backBtn = document.createElement('button')
  backBtn.className = 'btn--icon'
  backBtn.innerHTML = `<svg class="icon-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>`
  backBtn.addEventListener('click', () => {
    if (editingFile) {
      editingFile = null
      editingContent = null
      render()
    } else {
      onClose()
    }
  })
  header.appendChild(backBtn)
  const title = document.createElement('h1')
  title.className = 'text-xl font-bold text-white'
  title.textContent = `Site: ${forumName}`
  header.appendChild(title)
  el.appendChild(header)

  const content = document.createElement('div')
  content.className = 'page-content'
  el.appendChild(content)

  function apiUrl(path: string): string {
    return `https://${domain}/api/platform/sites/${slug}${path}`
  }

  function authHeaders(): Record<string, string> {
    const session = auth.getSession()
    if (!session) return {}
    return {
      'Authorization': `Bearer ${session.access_token}`,
      'X-Forumline-ID': session.user.id,
    }
  }

  async function fetchManifest() {
    loading = true
    render()
    try {
      const res = await fetch(apiUrl('/files'), { headers: authHeaders() })
      if (res.status === 403) {
        showToast('You don\'t have permission to edit this site', 'error')
        onClose()
        return
      }
      if (!res.ok) throw new Error(await res.text())
      manifest = await res.json()
    } catch (err) {
      showToast(err instanceof Error ? `Failed to load files: ${err.message}` : 'Failed to load files', 'error')
      manifest = { files: {}, updated: '', storage_bytes: 0, storage_limit: 52428800 }
    }
    loading = false
    render()
  }

  let uploading = false

  async function uploadFiles(files: FileList) {
    if (uploading) return
    uploading = true
    render()
    const formData = new FormData()
    for (const file of files) {
      formData.append('file', file, file.name.toLowerCase())
    }
    try {
      const res = await fetch(apiUrl('/upload'), {
        method: 'POST',
        headers: authHeaders(),
        body: formData,
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(detail || 'Upload failed')
      }
      const result = await res.json()
      if (result.errors?.length) {
        showToast(`Errors: ${result.errors.join(', ')}`, 'error')
      }
      if (result.uploaded?.length) {
        showToast(`Uploaded ${result.uploaded.length} file(s)`, 'success')
      }
      await fetchManifest()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Upload failed', 'error')
    } finally {
      uploading = false
      render()
    }
  }

  async function deleteFile(path: string) {
    try {
      const res = await fetch(apiUrl(`/files/${path}`), {
        method: 'DELETE',
        headers: authHeaders(),
      })
      if (!res.ok) throw new Error(await res.text())
      showToast(`Deleted ${path}`, 'success')
      await fetchManifest()
    } catch (err) {
      showToast(err instanceof Error ? `Delete failed: ${err.message}` : 'Delete failed', 'error')
    }
  }

  async function saveFile(path: string, fileContent: string) {
    try {
      const res = await fetch(apiUrl(`/files/${path}`), {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/octet-stream' },
        body: fileContent,
      })
      if (!res.ok) throw new Error(await res.text())
      showToast(`Saved ${path}`, 'success')
      await fetchManifest()
    } catch (err) {
      showToast(err instanceof Error ? `Save failed: ${err.message}` : 'Save failed', 'error')
    }
  }

  async function loadFileContent(path: string) {
    try {
      const res = await fetch(apiUrl(`/files/${path}`), { headers: authHeaders() })
      if (!res.ok) throw new Error(await res.text())
      return await res.text()
    } catch {
      showToast('Failed to load file', 'error')
      return null
    }
  }

  async function resetSite() {
    if (!confirm('Delete all custom files and revert to the default forum frontend?')) return
    try {
      const res = await fetch(apiUrl('/reset'), {
        method: 'POST',
        headers: authHeaders(),
      })
      if (!res.ok) throw new Error(await res.text())
      showToast('Site reset to default', 'success')
      await fetchManifest()
    } catch (err) {
      showToast(err instanceof Error ? `Reset failed: ${err.message}` : 'Reset failed', 'error')
    }
  }

  async function openEditor(path: string) {
    const fileContent = await loadFileContent(path)
    if (fileContent === null) return
    editingFile = path
    editingContent = fileContent
    render()
  }

  async function createNewFile() {
    const name = prompt('File name (e.g., style.css):')
    if (!name) return
    const clean = name.toLowerCase().trim()
    if (!clean) return
    // Client-side path validation
    if (clean.includes('..') || clean.startsWith('/') || clean.split('/').some(s => s.startsWith('.'))) {
      showToast('Invalid filename: path traversal or hidden files not allowed', 'error')
      return
    }
    editingFile = clean
    editingContent = ''
    render()
  }

  function renderEditor() {
    content.innerHTML = ''

    const editorCard = createCard()
    editorCard.style.display = 'flex'
    editorCard.style.flexDirection = 'column'
    editorCard.style.gap = '0.75rem'

    const fileLabel = document.createElement('div')
    fileLabel.className = 'text-sm font-medium text-white'
    fileLabel.textContent = editingFile ?? ''
    editorCard.appendChild(fileLabel)

    const textarea = document.createElement('textarea')
    textarea.className = 'site-editor'
    textarea.value = editingContent || ''
    textarea.spellcheck = false
    // Basic tab support
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault()
        const start = textarea.selectionStart
        const end = textarea.selectionEnd
        textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end)
        textarea.selectionStart = textarea.selectionEnd = start + 2
      }
    })
    editorCard.appendChild(textarea)

    const btnRow = document.createElement('div')
    btnRow.style.display = 'flex'
    btnRow.style.gap = '0.5rem'
    btnRow.appendChild(createButton({
      text: 'Save',
      variant: 'primary',
      onClick: () => { if (editingFile) saveFile(editingFile, textarea.value) },
    }))
    btnRow.appendChild(createButton({
      text: 'Cancel',
      variant: 'secondary',
      onClick: () => { editingFile = null; editingContent = null; render() },
    }))
    editorCard.appendChild(btnRow)

    content.appendChild(editorCard)
  }

  function renderFileList() {
    content.innerHTML = ''

    if (!manifest) return

    // Storage bar
    const storageCard = createCard()
    const storageLabel = document.createElement('div')
    storageLabel.className = 'text-sm text-muted'
    storageLabel.textContent = `Storage: ${formatBytes(manifest.storage_bytes)} / ${formatBytes(manifest.storage_limit)}`
    storageCard.appendChild(storageLabel)

    const barOuter = document.createElement('div')
    barOuter.className = 'site-storage-bar'
    const barInner = document.createElement('div')
    barInner.className = 'site-storage-bar__fill'
    const pct = Math.min(100, (manifest.storage_bytes / manifest.storage_limit) * 100)
    barInner.style.width = `${pct}%`
    if (pct > 90) barInner.style.backgroundColor = 'var(--color-red)'
    barOuter.appendChild(barInner)
    storageCard.appendChild(barOuter)
    content.appendChild(storageCard)

    // Action buttons
    const actionsCard = createCard()
    actionsCard.style.display = 'flex'
    actionsCard.style.flexWrap = 'wrap'
    actionsCard.style.gap = '0.5rem'

    // Upload zone
    const uploadInput = document.createElement('input')
    uploadInput.type = 'file'
    uploadInput.multiple = true
    uploadInput.style.display = 'none'
    uploadInput.addEventListener('change', () => {
      if (uploadInput.files?.length) uploadFiles(uploadInput.files)
    })
    actionsCard.appendChild(uploadInput)

    const uploadBtn = createButton({
      text: uploading ? 'Uploading...' : 'Upload Files',
      variant: 'primary',
      disabled: uploading,
      onClick: () => uploadInput.click(),
    })
    actionsCard.appendChild(uploadBtn)
    actionsCard.appendChild(createButton({
      text: 'New File',
      variant: 'secondary',
      onClick: createNewFile,
    }))
    actionsCard.appendChild(createButton({
      html: `<svg class="icon-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="vertical-align:middle"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg> Preview`,
      variant: 'ghost',
      onClick: () => window.open(`https://${domain}`, '_blank'),
    }))

    const fileKeys = Object.keys(manifest.files)
    if (fileKeys.length > 0) {
      actionsCard.appendChild(createButton({
        text: 'Reset to Default',
        variant: 'danger',
        onClick: resetSite,
      }))
    }
    content.appendChild(actionsCard)

    // Drop zone
    const dropZone = document.createElement('div')
    dropZone.className = 'site-drop-zone'
    dropZone.textContent = 'Drag and drop files here'
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('site-drop-zone--active') })
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('site-drop-zone--active'))
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault()
      dropZone.classList.remove('site-drop-zone--active')
      if (e.dataTransfer?.files.length) uploadFiles(e.dataTransfer.files)
    })
    content.appendChild(dropZone)

    // File list
    if (fileKeys.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'text-sm text-faint mt-lg'
      empty.textContent = 'No custom files yet. Upload an index.html to get started.'
      content.appendChild(empty)
      return
    }

    const filesCard = createCard()
    const filesTitle = document.createElement('h2')
    filesTitle.className = 'text-lg font-semibold text-white'
    filesTitle.textContent = 'Files'
    filesCard.appendChild(filesTitle)

    const fileList = document.createElement('div')
    fileList.className = 'site-file-list'

    for (const [path, file] of Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b))) {
      const row = document.createElement('div')
      row.className = 'site-file-row'

      const icon = document.createElement('span')
      icon.innerHTML = fileIcon(path)
      row.appendChild(icon)

      const info = document.createElement('div')
      info.className = 'flex-1'
      const nameEl = document.createElement('span')
      nameEl.className = 'text-sm font-medium text-white'
      nameEl.textContent = path
      const sizeEl = document.createElement('span')
      sizeEl.className = 'text-xs text-muted'
      sizeEl.textContent = ` (${formatBytes(file.size)})`
      info.append(nameEl, sizeEl)
      row.appendChild(info)

      const btnGroup = document.createElement('div')
      btnGroup.style.display = 'flex'
      btnGroup.style.gap = '0.25rem'

      if (isTextFile(path)) {
        btnGroup.appendChild(createButton({
          text: 'Edit',
          variant: 'ghost',
          className: 'text-xs',
          onClick: () => openEditor(path),
        }))
      }

      btnGroup.appendChild(createButton({
        text: 'Delete',
        variant: 'link-muted',
        className: 'text-xs',
        onClick: () => {
          if (confirm(`Delete ${path}?`)) deleteFile(path)
        },
      }))

      row.appendChild(btnGroup)
      fileList.appendChild(row)
    }

    filesCard.appendChild(fileList)
    content.appendChild(filesCard)
  }

  function render() {
    if (loading) {
      content.innerHTML = ''
      const spinWrap = document.createElement('div')
      spinWrap.style.display = 'flex'
      spinWrap.style.justifyContent = 'center'
      spinWrap.style.padding = '2rem'
      spinWrap.appendChild(createSpinner())
      content.appendChild(spinWrap)
      return
    }

    if (editingFile !== null) {
      renderEditor()
    } else {
      renderFileList()
    }
  }

  fetchManifest()

  return {
    el,
    destroy() {},
  }
}
