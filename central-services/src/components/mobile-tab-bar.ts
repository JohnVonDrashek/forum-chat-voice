import type { ForumStore } from '../lib/index.js'

export type AppView = 'forums' | 'settings' | 'dms'

interface MobileTabBarOptions {
  forumStore: ForumStore
  onChangeView: (view: AppView) => void
}

export interface MobileTabBarInstance {
  el: HTMLElement
  destroy: () => void
  update: (view: AppView, dmUnreadCount: number) => void
}

export function createMobileTabBar({ forumStore, onChangeView }: MobileTabBarOptions): MobileTabBarInstance {
  let currentView: AppView = 'forums'
  let dmUnread = 0

  const el = document.createElement('div')
  el.className = 'tab-bar'

  // Build buttons once
  const forumsBtn = document.createElement('button')
  forumsBtn.innerHTML = `
    <svg class="icon-md" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
    </svg>
    <span class="tab-bar__label">Forums</span>
  `
  forumsBtn.addEventListener('click', () => {
    if (currentView === 'forums' && forumStore.get().activeForum) {
      forumStore.goHome()
    }
    onChangeView('forums')
  })
  el.appendChild(forumsBtn)

  // DMs button with badge container
  const dmsBtn = document.createElement('button')
  const dmIconWrap = document.createElement('div')
  dmIconWrap.className = 'relative'
  dmIconWrap.innerHTML = `
    <svg class="icon-md" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
    </svg>
  `
  let dmBadgeEl: HTMLElement | null = null
  dmsBtn.appendChild(dmIconWrap)
  const dmsLabel = document.createElement('span')
  dmsLabel.className = 'tab-bar__label'
  dmsLabel.textContent = 'DMs'
  dmsBtn.appendChild(dmsLabel)
  dmsBtn.addEventListener('click', () => onChangeView(currentView === 'dms' ? 'forums' : 'dms'))
  el.appendChild(dmsBtn)

  // Settings button
  const settingsBtn = document.createElement('button')
  settingsBtn.innerHTML = `
    <svg class="icon-md" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
    </svg>
    <span class="tab-bar__label">Settings</span>
  `
  settingsBtn.addEventListener('click', () => onChangeView(currentView === 'settings' ? 'forums' : 'settings'))
  el.appendChild(settingsBtn)

  const allBtns = [forumsBtn, dmsBtn, settingsBtn] as const
  const viewMap: Record<AppView, HTMLElement> = { forums: forumsBtn, dms: dmsBtn, settings: settingsBtn }

  function applyState() {
    // Update active classes
    for (const btn of allBtns) {
      btn.className = 'tab-bar__item'
    }
    viewMap[currentView].classList.add('tab-bar__item--active')

    // Update DM badge
    if (dmUnread > 0) {
      if (!dmBadgeEl) {
        dmBadgeEl = document.createElement('div')
        dmBadgeEl.className = 'badge badge--red badge--inline'
        dmBadgeEl.style.cssText = 'position:absolute;right:-8px;top:-4px;min-width:16px;height:16px;font-size:9px'
        dmIconWrap.appendChild(dmBadgeEl)
      }
      dmBadgeEl.textContent = dmUnread > 99 ? '99+' : String(dmUnread)
    } else if (dmBadgeEl) {
      dmBadgeEl.remove()
      dmBadgeEl = null
    }
  }

  applyState()

  return {
    el,
    destroy() {},
    update(view: AppView, dmUnreadCount: number) {
      const changed = currentView !== view || dmUnread !== dmUnreadCount
      currentView = view
      dmUnread = dmUnreadCount
      if (changed) applyState()
    },
  }
}
