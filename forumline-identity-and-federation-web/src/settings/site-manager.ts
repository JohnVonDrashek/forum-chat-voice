/*
 * Hosted site file manager (Van.js + VanX)
 *
 * This file lets forum owners manage the custom frontend files of their hosted Forumline forum.
 *
 * It must:
 * - Display a storage usage bar showing how much of the site's storage quota is used
 * - List all custom files with their names, sizes, and file-type icons
 * - Allow uploading new files via a file picker or drag-and-drop zone
 * - Allow creating new text files (HTML, CSS, JS, etc.) with a built-in code editor
 * - Allow editing existing text files in a textarea with basic tab support
 * - Allow deleting individual files with a confirmation prompt
 * - Allow resetting the entire site back to the default forum template
 * - Provide a "Preview" link to open the live site in a new tab
 * - Show toast notifications for upload, save, delete, and reset results
 * - Enforce permission checks and show an error if the user lacks access
 * - Navigate between the file list view and the editor view with back navigation
 */
import type { GoTrueAuthClient } from '../auth/gotrue-auth.js'
import { tags, html, vanX } from '../shared/dom.js'
import { createButton, createInput, createCard, createSpinner, showToast } from '../shared/ui.js'

const { div, h1, h2, p } = tags

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
  return `<svg class="icon-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`
}

export function createSiteManager({ slug, forumName, domain, auth, onClose }: SiteManagerOptions) {
  const ui = vanX.reactive({
    manifest: null as SiteManifest | null,
    editingFile: null as string | null,
    editingContent: null as string | null,
    loading: true,
    uploading: false,
  })

  function apiUrl(path: string): string {
    return `https://${domain}/api/platform/sites/${slug}${path}`
  }

  function authHeaders(): Record<string, string> {
    const session = auth.getSession()
    if (!session) return {}
    return { Authorization: `Bearer ${session.access_token}`, 'X-Forumline-ID': session.user.id }
  }

  async function fetchManifest() {
    ui.loading = true
    try {
      const res = await fetch(apiUrl('/files'), { headers: authHeaders() })
      if (res.status === 403) { showToast("You don't have permission to edit this site", 'error'); onClose(); return }
      if (!res.ok) throw new Error(await res.text())
      ui.manifest = await res.json()
    } catch (err) {
      showToast(err instanceof Error ? `Failed to load files: ${err.message}` : 'Failed to load files', 'error')
      ui.manifest = { files: {}, updated: '', storage_bytes: 0, storage_limit: 52428800 }
    }
    ui.loading = false
  }

  async function uploadFiles(files: FileList) {
    if (ui.uploading) return
    ui.uploading = true
    const formData = new FormData()
    for (const file of files) formData.append('file', file, file.name.toLowerCase())
    try {
      const res = await fetch(apiUrl('/upload'), { method: 'POST', headers: authHeaders(), body: formData })
      if (!res.ok) throw new Error(await res.text().catch(() => '') || 'Upload failed')
      const result = await res.json()
      if (result.errors?.length) showToast(`Errors: ${result.errors.join(', ')}`, 'error')
      if (result.uploaded?.length) showToast(`Uploaded ${result.uploaded.length} file(s)`, 'success')
      await fetchManifest()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Upload failed', 'error')
    } finally { ui.uploading = false }
  }

  async function deleteFile(path: string) {
    try {
      const res = await fetch(apiUrl(`/files/${path}`), { method: 'DELETE', headers: authHeaders() })
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
        method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/octet-stream' }, body: fileContent,
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
    } catch { showToast('Failed to load file', 'error'); return null }
  }

  async function resetSite() {
    if (!confirm('Delete all custom files and revert to the default forum frontend?')) return
    try {
      const res = await fetch(apiUrl('/reset'), { method: 'POST', headers: authHeaders() })
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
    ui.editingFile = path
    ui.editingContent = fileContent
  }

  async function createNewFile() {
    const name = prompt('File name (e.g., style.css):')
    if (!name) return
    const clean = name.toLowerCase().trim()
    if (!clean) return
    if (clean.includes('..') || clean.startsWith('/') || clean.split('/').some(s => s.startsWith('.'))) {
      showToast('Invalid filename: path traversal or hidden files not allowed', 'error'); return
    }
    ui.editingFile = clean
    ui.editingContent = ''
  }

  function buildEditorView(): HTMLElement {
    const editorCard = createCard()
    editorCard.style.cssText = 'display:flex;flex-direction:column;gap:0.75rem'

    editorCard.appendChild(div({ class: 'text-sm font-medium text-white' }, ui.editingFile ?? '') as HTMLElement)

    const textarea = tags.textarea({
      class: 'site-editor',
      value: ui.editingContent || '',
      spellcheck: false,
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === 'Tab') {
          e.preventDefault()
          const ta = textarea as HTMLTextAreaElement
          const start = ta.selectionStart, end = ta.selectionEnd
          ta.value = ta.value.substring(0, start) + '  ' + ta.value.substring(end)
          ta.selectionStart = ta.selectionEnd = start + 2
        }
      },
    }) as HTMLTextAreaElement
    editorCard.appendChild(textarea)

    const btnRow = div({ style: 'display:flex;gap:0.5rem' }) as HTMLElement
    btnRow.append(
      createButton({ text: 'Save', variant: 'primary', onClick: () => { if (ui.editingFile) saveFile(ui.editingFile, textarea.value) } }),
      createButton({ text: 'Cancel', variant: 'secondary', onClick: () => { ui.editingFile = null; ui.editingContent = null } }),
    )
    editorCard.appendChild(btnRow)
    return editorCard
  }

  function buildFileListView(): HTMLElement {
    const wrapper = div() as HTMLElement
    const m = ui.manifest
    if (!m) return wrapper

    // Storage bar
    const storageCard = createCard()
    storageCard.appendChild(div({ class: 'text-sm text-muted' }, `Storage: ${formatBytes(m.storage_bytes)} / ${formatBytes(m.storage_limit)}`) as HTMLElement)
    const barOuter = div({ class: 'site-storage-bar' }) as HTMLElement
    const barInner = div({ class: 'site-storage-bar__fill' }) as HTMLElement
    const pct = Math.min(100, (m.storage_bytes / m.storage_limit) * 100)
    barInner.style.width = `${pct}%`
    if (pct > 90) barInner.style.backgroundColor = 'var(--color-red)'
    barOuter.appendChild(barInner)
    storageCard.appendChild(barOuter)
    wrapper.appendChild(storageCard)

    // Actions
    const actionsCard = createCard()
    actionsCard.style.cssText = 'display:flex;flex-wrap:wrap;gap:0.5rem'
    const uploadInput = tags.input({
      type: 'file', multiple: true, style: 'display:none',
      onchange: () => { if ((uploadInput as HTMLInputElement).files?.length) uploadFiles((uploadInput as HTMLInputElement).files!) },
    }) as HTMLInputElement
    actionsCard.appendChild(uploadInput)
    actionsCard.append(
      createButton({ text: ui.uploading ? 'Uploading...' : 'Upload Files', variant: 'primary', disabled: ui.uploading, onClick: () => uploadInput.click() }),
      createButton({ text: 'New File', variant: 'secondary', onClick: createNewFile }),
      createButton({ html: `<svg class="icon-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="vertical-align:middle"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg> Preview`, variant: 'ghost', onClick: () => window.open(`https://${domain}`, '_blank') }),
    )
    const fileKeys = Object.keys(m.files)
    if (fileKeys.length > 0) actionsCard.appendChild(createButton({ text: 'Reset to Default', variant: 'danger', onClick: resetSite }))
    wrapper.appendChild(actionsCard)

    // Drop zone
    const dropZone = div({
      class: 'site-drop-zone',
      ondragover: (e: DragEvent) => { e.preventDefault(); dropZone.classList.add('site-drop-zone--active') },
      ondragleave: () => dropZone.classList.remove('site-drop-zone--active'),
      ondrop: (e: DragEvent) => {
        e.preventDefault(); dropZone.classList.remove('site-drop-zone--active')
        if (e.dataTransfer?.files.length) uploadFiles(e.dataTransfer.files)
      },
    }, 'Drag and drop files here') as HTMLElement
    wrapper.appendChild(dropZone)

    // File list
    if (fileKeys.length === 0) {
      wrapper.appendChild(p({ class: 'text-sm text-faint mt-lg' }, 'No custom files yet. Upload an index.html to get started.') as HTMLElement)
      return wrapper
    }

    const filesCard = createCard()
    filesCard.appendChild(h2({ class: 'text-lg font-semibold text-white' }, 'Files') as HTMLElement)
    const fileList = div({ class: 'site-file-list' }) as HTMLElement

    for (const [path, file] of Object.entries(m.files).sort(([a], [b]) => a.localeCompare(b))) {
      const row = div({ class: 'site-file-row' }) as HTMLElement
      const icon = tags.span({}, html(fileIcon(path))) as HTMLElement
      row.appendChild(icon)

      const info = div({ class: 'flex-1' },
        tags.span({ class: 'text-sm font-medium text-white' }, path),
        tags.span({ class: 'text-xs text-muted' }, ` (${formatBytes(file.size)})`),
      ) as HTMLElement
      row.appendChild(info)

      const btnGroup = div({ style: 'display:flex;gap:0.25rem' }) as HTMLElement
      if (isTextFile(path)) {
        btnGroup.appendChild(createButton({ text: 'Edit', variant: 'ghost', className: 'text-xs', onClick: () => openEditor(path) }))
      }
      btnGroup.appendChild(createButton({
        text: 'Delete', variant: 'link-muted', className: 'text-xs',
        onClick: () => { if (confirm(`Delete ${path}?`)) deleteFile(path) },
      }))
      row.appendChild(btnGroup)
      fileList.appendChild(row)
    }
    filesCard.appendChild(fileList)
    wrapper.appendChild(filesCard)
    return wrapper
  }

  // Header
  const header = div({ class: 'settings-header' }) as HTMLElement
  const backBtn = tags.button({ class: 'btn--icon', onclick: () => {
    if (ui.editingFile) { ui.editingFile = null; ui.editingContent = null }
    else onClose()
  }},
    html(`<svg class="icon-sm" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>`),
  ) as HTMLButtonElement
  header.append(backBtn, h1({ class: 'text-xl font-bold text-white' }, `Site: ${forumName}`) as HTMLElement)

  const el = div({ class: 'page-scroll' },
    header,
    div({ class: 'page-content' },
      () => {
        if (ui.loading) {
          const spinWrap = div({ style: 'display:flex;justify-content:center;padding:2rem' }) as HTMLElement
          spinWrap.appendChild(createSpinner())
          return spinWrap
        }
        if (ui.editingFile !== null) return buildEditorView()
        return buildFileListView()
      },
    ),
  ) as HTMLElement

  fetchManifest()

  return { el, destroy() {} }
}
