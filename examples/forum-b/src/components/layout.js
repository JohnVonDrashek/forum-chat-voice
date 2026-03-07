/**
 * Gothic layout — header, three-column with sidebar, floating stars.
 */

import { renderHeader, cleanupHeader } from './header.js'
import { renderSidebar, renderMobileSidebar, loadSidebarData, closeMobileSidebar } from './sidebar.js'
import { authStore } from '../lib/auth.js'

export function renderLayout(container) {
  container.innerHTML = `
    <div id="header-container"></div>
    <div class="layout-wrapper">
      <div id="sidebar-container"></div>
      <div class="layout-main">
        <div id="page-content"></div>
      </div>
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

  // Add floating star decorations
  spawnFloatingStars()

  return () => {
    unsub()
    cleanupHeader()
  }
}

export function getPageContainer() {
  return document.getElementById('page-content')
}

function spawnFloatingStars() {
  const container = document.getElementById('floating-decor')
  if (!container) return
  const stars = ['*', '+', '.', '*']
  for (let i = 0; i < 12; i++) {
    const star = document.createElement('div')
    star.className = 'floating-star'
    star.textContent = stars[i % stars.length]
    star.style.left = Math.random() * 100 + '%'
    star.style.top = Math.random() * 100 + '%'
    star.style.animationDelay = (Math.random() * 6) + 's'
    star.style.animationDuration = (4 + Math.random() * 4) + 's'
    star.style.fontSize = (8 + Math.random() * 8) + 'px'
    container.appendChild(star)
  }
}
