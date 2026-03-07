/**
 * Gothic sidebar — navigation in bordered panels.
 */

import { api } from '../lib/api.js'
import { voiceStore, leaveRoom } from '../lib/voice.js'
import { authStore } from '../lib/auth.js'
import { getCurrentPath, onRouteChange } from '../router.js'

let categories = []
let channels = []
let rooms = []

export async function loadSidebarData() {
  try {
    [categories, channels, rooms] = await Promise.all([
      api.getCategories(),
      api.getChannels(),
      api.getVoiceRooms(),
    ])
  } catch {}
}

export function renderSidebarContent(container) {
  const path = getCurrentPath()
  const voice = voiceStore.get()

  container.innerHTML = `
    <div class="gothic-box">
      <div class="gothic-box-header">~ Navigation ~</div>
      <div class="gothic-box-content" style="padding:6px 0">
        <ul class="sidebar-nav">
          <li><a href="/" class="${path === '/' ? 'active' : ''}">
            <svg style="width:12px;height:12px" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>
            Home
          </a></li>
        </ul>
      </div>
    </div>

    ${categories.length ? `
      <div class="gothic-box">
        <div class="gothic-box-header">~ Categories ~</div>
        <div class="gothic-box-content" style="padding:6px 0">
          <ul class="sidebar-nav">
            ${categories.map(c => `
              <li><a href="/c/${c.slug}" class="${path === `/c/${c.slug}` ? 'active' : ''}">
                <span class="sidebar-dot"></span>
                ${escapeHTML(c.name)}
              </a></li>
            `).join('')}
          </ul>
        </div>
      </div>
    ` : ''}

    ${channels.length ? `
      <div class="gothic-box">
        <div class="gothic-box-header">~ Chat ~</div>
        <div class="gothic-box-content" style="padding:6px 0">
          <ul class="sidebar-nav">
            ${channels.map(ch => `
              <li><a href="/chat/${ch.id}" class="${path === `/chat/${ch.id}` ? 'active' : ''}">
                <span style="color:var(--accent-gold)">#</span>
                ${escapeHTML(ch.name)}
              </a></li>
            `).join('')}
          </ul>
        </div>
      </div>
    ` : ''}

    ${rooms.length ? `
      <div class="gothic-box">
        <div class="gothic-box-header">~ Voice ~</div>
        <div class="gothic-box-content" style="padding:6px 0">
          <ul class="sidebar-nav">
            ${rooms.map(r => {
              const info = voice.roomParticipantCounts[r.slug]
              const isActive = voice.connectedRoomSlug === r.slug
              return `
                <li><a href="/voice/${r.id}" class="${isActive ? 'active' : path === `/voice/${r.id}` ? 'active' : ''}" ${isActive ? 'style="color:var(--accent-green)"' : ''}>
                  <svg style="width:12px;height:12px" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/></svg>
                  ${escapeHTML(r.name)}
                  ${info && info.count > 0 ? `<span class="sidebar-voice-count">${info.count}</span>` : ''}
                </a></li>
              `
            }).join('')}
          </ul>
          ${voice.isConnected ? `
            <div class="sidebar-voice-active">
              <span class="sidebar-voice-active-name">${escapeHTML(voice.connectedRoomName || '')}</span>
              <button id="sidebar-leave-voice" class="sidebar-voice-leave">[leave]</button>
            </div>
          ` : ''}
        </div>
      </div>
    ` : ''}
  `

  const leaveBtn = container.querySelector('#sidebar-leave-voice')
  if (leaveBtn) leaveBtn.addEventListener('click', leaveRoom)
}

export function renderSidebar(container) {
  container.innerHTML = `
    <aside class="layout-sidebar">
      <div id="sidebar-content"></div>
    </aside>
  `
  renderSidebarContent(container.querySelector('#sidebar-content'))
}

export function renderMobileSidebar(container) {
  container.innerHTML = `
    <div id="mobile-sidebar" class="mobile-overlay">
      <div id="mobile-sidebar-overlay" class="mobile-overlay-bg"></div>
      <div class="mobile-sidebar-panel">
        <div id="mobile-sidebar-content"></div>
      </div>
    </div>
  `
  renderSidebarContent(container.querySelector('#mobile-sidebar-content'))

  const overlay = container.querySelector('#mobile-sidebar-overlay')
  if (overlay) {
    overlay.addEventListener('click', () => {
      container.querySelector('#mobile-sidebar')?.classList.remove('open')
    })
  }
}

export function closeMobileSidebar() {
  document.getElementById('mobile-sidebar')?.classList.remove('open')
}

function escapeHTML(str) {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

// Re-render sidebar when voice state or route changes
function refreshSidebar() {
  const el = document.getElementById('sidebar-content')
  if (el) renderSidebarContent(el)
  const mel = document.getElementById('mobile-sidebar-content')
  if (mel) renderSidebarContent(mel)
}

voiceStore.subscribe(refreshSidebar)
onRouteChange(refreshSidebar)
