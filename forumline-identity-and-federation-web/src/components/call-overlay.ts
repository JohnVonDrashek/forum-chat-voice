/**
 * Call overlay — full-screen for ringing, compact top bar for active calls.
 */

import {
  onCallStateChange,
  acceptCall,
  declineCall,
  endCall,
  toggleMute,
  isMuted,
  type CallState,
  type CallInfo,
} from '../lib/call-manager.js'
import { createAvatar } from './ui.js'
import { playRingtone } from '../lib/call-ringtone.js'

export function createCallOverlay() {
  const el = document.createElement('div')

  let currentState: CallState = 'idle'
  let currentInfo: CallInfo | null = null
  let callDuration = 0
  let durationInterval: ReturnType<typeof setInterval> | null = null
  let stopRingtone: (() => void) | null = null

  function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  function applyFullScreenStyle() {
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;display:flex;background:rgba(0,0,0,0.85);flex-direction:column;align-items:center;justify-content:center;gap:1.5rem'
  }

  function applyBarStyle() {
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;display:flex;align-items:center;gap:0.75rem;padding:0.5rem 1rem;background:var(--color-green, #22c55e);color:white;font-size:0.875rem;cursor:pointer'
  }

  function render() {
    el.innerHTML = ''

    if (currentState === 'idle' || !currentInfo) {
      el.style.cssText = 'display:none'
      if (durationInterval) { clearInterval(durationInterval); durationInterval = null }
      callDuration = 0
      return
    }

    // --- Active call: compact top bar ---
    if (currentState === 'active') {
      applyBarStyle()

      // Stop any ringtone
      if (stopRingtone) { stopRingtone(); stopRingtone = null }

      // Duration
      const durationEl = document.createElement('span')
      durationEl.style.fontWeight = '600'
      durationEl.textContent = formatDuration(callDuration)
      if (durationInterval) clearInterval(durationInterval)
      durationInterval = setInterval(() => {
        callDuration++
        durationEl.textContent = formatDuration(callDuration)
      }, 1000)
      el.appendChild(durationEl)

      // Name
      const nameEl = document.createElement('span')
      nameEl.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
      nameEl.textContent = currentInfo.remoteDisplayName
      el.appendChild(nameEl)

      // Mute button (small)
      const muteBtn = document.createElement('button')
      muteBtn.style.cssText = 'background:none;border:none;color:white;cursor:pointer;padding:0.25rem;opacity:' + (isMuted() ? '0.5' : '1')
      muteBtn.title = isMuted() ? 'Unmute' : 'Mute'
      muteBtn.innerHTML = isMuted() ? muteOffIconSm : muteIconSm
      muteBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        toggleMute()
        render()
      })
      el.appendChild(muteBtn)

      // Hangup button (small)
      const hangBtn = document.createElement('button')
      hangBtn.style.cssText = 'background:#ef4444;border:none;color:white;cursor:pointer;padding:0.25rem 0.5rem;border-radius:1rem;font-size:0.75rem;font-weight:600'
      hangBtn.textContent = 'End'
      hangBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        endCall()
      })
      el.appendChild(hangBtn)

      return
    }

    // --- Ringing states: full-screen overlay ---
    applyFullScreenStyle()

    // Avatar
    const avatar = createAvatar({
      avatarUrl: currentInfo.remoteAvatarUrl,
      seed: currentInfo.remoteDisplayName,
      size: 96,
    })
    avatar.style.borderRadius = '50%'
    el.appendChild(avatar)

    // Name
    const name = document.createElement('div')
    name.style.cssText = 'font-size:1.25rem;font-weight:600;color:white'
    name.textContent = currentInfo.remoteDisplayName
    el.appendChild(name)

    // Status text
    const status = document.createElement('div')
    status.style.cssText = 'font-size:0.875rem;color:rgba(255,255,255,0.6)'
    el.appendChild(status)

    if (currentState === 'ringing-outgoing') {
      status.textContent = 'Calling...'

      const btnRow = document.createElement('div')
      btnRow.style.cssText = 'display:flex;gap:1.5rem;margin-top:1rem'

      const cancelBtn = makeCircleBtn('red', hangUpIcon)
      cancelBtn.addEventListener('click', () => endCall())
      btnRow.appendChild(cancelBtn)

      el.appendChild(btnRow)
    } else if (currentState === 'ringing-incoming') {
      status.textContent = 'Incoming call'

      const btnRow = document.createElement('div')
      btnRow.style.cssText = 'display:flex;gap:2rem;margin-top:1rem'

      const declineBtn = makeCircleBtn('red', hangUpIcon)
      declineBtn.addEventListener('click', () => declineCall())
      btnRow.appendChild(declineBtn)

      const acceptBtn = makeCircleBtn('green', phoneIcon)
      acceptBtn.addEventListener('click', () => acceptCall())
      btnRow.appendChild(acceptBtn)

      el.appendChild(btnRow)
    }
  }

  const unsub = onCallStateChange((newState, info) => {
    const prevState = currentState
    currentState = newState
    currentInfo = info

    // Stop ringtone when leaving a ringing state
    if (prevState !== newState && stopRingtone) {
      stopRingtone()
      stopRingtone = null
    }

    // Start ringtone when entering a ringing state
    if (newState === 'ringing-outgoing' && prevState !== 'ringing-outgoing') {
      stopRingtone = playRingtone('outgoing')
    } else if (newState === 'ringing-incoming' && prevState !== 'ringing-incoming') {
      stopRingtone = playRingtone('incoming')
    }

    if (newState !== 'active' && prevState === 'active') {
      if (durationInterval) { clearInterval(durationInterval); durationInterval = null }
      callDuration = 0
    }

    render()
  })

  render()

  return {
    el,
    destroy() {
      unsub()
      if (durationInterval) clearInterval(durationInterval)
      if (stopRingtone) stopRingtone()
    },
  }
}

// --- Button helpers ---

function makeCircleBtn(color: string, iconSvg: string): HTMLButtonElement {
  const btn = document.createElement('button')
  const bgColors: Record<string, string> = {
    red: '#ef4444',
    green: '#22c55e',
    gray: 'rgba(255,255,255,0.15)',
    orange: '#f97316',
  }
  btn.style.cssText = `width:56px;height:56px;border-radius:50%;border:none;background:${bgColors[color] || bgColors.gray};cursor:pointer;display:flex;align-items:center;justify-content:center;color:white;transition:opacity 0.15s`
  btn.innerHTML = iconSvg
  btn.addEventListener('mouseenter', () => { btn.style.opacity = '0.8' })
  btn.addEventListener('mouseleave', () => { btn.style.opacity = '1' })
  return btn
}

const hangUpIcon = `<svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 8l-8 8m0-8l8 8"/></svg>`
const phoneIcon = `<svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>`
const muteIconSm = `<svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/></svg>`
const muteOffIconSm = `<svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"/></svg>`
