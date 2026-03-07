/**
 * Layout — main app shell with header, sidebar, content area.
 */

import { renderHeader, cleanupHeader } from './header.js'
import { renderSidebar, renderMobileSidebar, loadSidebarData, closeMobileSidebar } from './sidebar.js'
import { authStore } from '../lib/auth.js'

export function renderLayout(container) {
  container.innerHTML = `
    <div id="header-container"></div>
    <div class="flex">
      <div id="sidebar-container"></div>
      <main class="flex-1 min-w-0 p-4 sm:p-6">
        <div id="page-content" class="mx-auto max-w-4xl"></div>
      </main>
    </div>
    <div id="mobile-sidebar-container"></div>
  `

  renderHeader(document.getElementById('header-container'))
  renderSidebar(document.getElementById('sidebar-container'))
  renderMobileSidebar(document.getElementById('mobile-sidebar-container'))

  loadSidebarData().then(() => {
    renderSidebar(document.getElementById('sidebar-container'))
    renderMobileSidebar(document.getElementById('mobile-sidebar-container'))
  })

  // Re-render header when auth changes
  const unsub = authStore.subscribe(() => {
    renderHeader(document.getElementById('header-container'))
  })

  return () => {
    unsub()
    cleanupHeader()
  }
}

export function getPageContainer() {
  return document.getElementById('page-content')
}
