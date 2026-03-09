/*
 * Voice call overlay (Van.js + VanX)
 *
 * This file renders the user-facing UI for 1:1 voice calls across the entire app.
 *
 * It must:
 * - Show a full-screen overlay with caller avatar, name, and accept/decline buttons for incoming calls
 * - Show a full-screen overlay with a "Calling..." status and cancel button for outgoing calls
 * - Collapse to a compact green top bar once the call is active, showing duration and controls
 * - Play distinct ringtone patterns for incoming vs outgoing ringing states
 * - Stop the ringtone when the call state changes (answered, declined, ended)
 * - Provide a mute/unmute toggle during active calls
 * - Provide an "End" button to hang up during active calls
 * - Track and display a live call duration timer (minutes:seconds)
 * - Hide completely when no call is in progress
 * - Read call state directly from the call manager's VanX reactive object (no duplicate state)
 */
import {
  callState,
  acceptCall,
  declineCall,
  endCall,
  toggleMute,
  type CallInfo,
} from './call-manager.js'
import { tags, html, van } from '../shared/dom.js'
import { createAvatar } from '../shared/ui.js'
import { playRingtone } from './call-ringtone.js'

const { div, span, button } = tags

export function createCallOverlay() {
  // Local overlay-specific state: call duration counter
  const callDuration = van.state(0)

  let durationInterval: ReturnType<typeof setInterval> | null = null
  let stopRingtone: (() => void) | null = null

  function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  function startDurationTimer() {
    if (durationInterval) clearInterval(durationInterval)
    callDuration.val = 0
    durationInterval = setInterval(() => {
      callDuration.val++
    }, 1000)
  }

  function stopDurationTimer() {
    if (durationInterval) { clearInterval(durationInterval); durationInterval = null }
    callDuration.val = 0
  }

  function renderActiveBar(info: CallInfo): HTMLElement {
    return div(
      {
        style: 'display:flex;align-items:center;gap:0.75rem;padding:0.5rem 1rem;cursor:pointer',
      },
      span({ style: 'font-weight:600' }, () => formatDuration(callDuration.val)),
      span(
        { style: 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' },
        info.remoteDisplayName,
      ),
      button(
        {
          style: () =>
            'background:none;border:none;color:white;cursor:pointer;padding:0.25rem;opacity:' +
            (callState.muted ? '0.5' : '1'),
          title: () => (callState.muted ? 'Unmute' : 'Mute'),
          onclick: (e: MouseEvent) => {
            e.stopPropagation()
            toggleMute()
          },
        },
        () => html(callState.muted ? muteOffIconSm : muteIconSm),
      ),
      button(
        {
          style:
            'background:#ef4444;border:none;color:white;cursor:pointer;padding:0.25rem 0.5rem;border-radius:1rem;font-size:0.75rem;font-weight:600',
          onclick: (e: MouseEvent) => {
            e.stopPropagation()
            endCall()
          },
        },
        'End',
      ),
    ) as HTMLElement
  }

  function renderRingingOverlay(info: CallInfo, ringState: 'ringing-outgoing' | 'ringing-incoming'): HTMLElement {
    const avatar = createAvatar({ avatarUrl: info.remoteAvatarUrl, seed: info.remoteDisplayName, size: 96 })
    avatar.style.borderRadius = '50%'

    const statusText = ringState === 'ringing-outgoing' ? 'Calling...' : 'Incoming call'

    const btnRow =
      ringState === 'ringing-outgoing'
        ? div({ style: 'display:flex;gap:1.5rem;margin-top:1rem' }, makeCircleBtn('red', hangUpIcon, () => endCall()))
        : div(
            { style: 'display:flex;gap:2rem;margin-top:1rem' },
            makeCircleBtn('red', hangUpIcon, () => declineCall()),
            makeCircleBtn('green', phoneIcon, () => acceptCall()),
          )

    return div(
      { style: 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.5rem;flex:1' },
      avatar,
      div({ style: 'font-size:1.25rem;font-weight:600;color:white' }, info.remoteDisplayName),
      div({ style: 'font-size:0.875rem;color:rgba(255,255,255,0.6)' }, statusText),
      btnRow,
    ) as HTMLElement
  }

  const el = div(
    {
      style: () => {
        const s = callState.state
        const info = callState.callInfo
        if (s === 'idle' || !info) return 'display:none'
        if (s === 'active')
          return 'position:fixed;top:0;left:0;right:0;z-index:9999;display:flex;align-items:center;background:var(--color-green, #22c55e);color:white;font-size:0.875rem'
        return 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;display:flex;background:rgba(0,0,0,0.85);flex-direction:column;align-items:center;justify-content:center'
      },
    },
    () => {
      const s = callState.state
      const info = callState.callInfo
      if (s === 'idle' || !info) return span({ style: 'display:none' })
      if (s === 'active') return renderActiveBar(info)
      if (s === 'ringing-outgoing' || s === 'ringing-incoming') return renderRingingOverlay(info, s)
      return span({ style: 'display:none' })
    },
  ) as HTMLElement

  // React to state changes for ringtone and duration timer.
  // van.derive runs whenever its reactive dependencies change.
  let prevState: string = 'idle'
  van.derive(() => {
    const s = callState.state

    // Stop ringtone on any state transition
    if (prevState !== s && stopRingtone) { stopRingtone(); stopRingtone = null }

    // Start ringtone for ringing states
    if (s === 'ringing-outgoing' && prevState !== 'ringing-outgoing') {
      stopRingtone = playRingtone('outgoing')
    } else if (s === 'ringing-incoming' && prevState !== 'ringing-incoming') {
      stopRingtone = playRingtone('incoming')
    }

    // Start/stop duration timer on active state transitions
    if (s === 'active' && prevState !== 'active') {
      startDurationTimer()
    }
    if (s !== 'active' && prevState === 'active') {
      stopDurationTimer()
    }
    if (s === 'idle') {
      stopDurationTimer()
    }

    prevState = s
  })

  return {
    el,
    destroy() {
      stopDurationTimer()
      if (stopRingtone) stopRingtone()
    },
  }
}

function makeCircleBtn(color: string, iconSvg: string, onclick?: () => void): HTMLButtonElement {
  const bgColors: Record<string, string> = { red: '#ef4444', green: '#22c55e', gray: 'rgba(255,255,255,0.15)', orange: '#f97316' }
  const btn = button({
    style: `width:56px;height:56px;border-radius:50%;border:none;background:${bgColors[color] || bgColors.gray};cursor:pointer;display:flex;align-items:center;justify-content:center;color:white;transition:opacity 0.15s`,
    onclick,
    onmouseenter: () => { (btn as HTMLButtonElement).style.opacity = '0.8' },
    onmouseleave: () => { (btn as HTMLButtonElement).style.opacity = '1' },
  }, html(iconSvg)) as HTMLButtonElement
  return btn
}

const hangUpIcon = `<svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 8l-8 8m0-8l8 8"/></svg>`
const phoneIcon = `<svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>`
const muteIconSm = `<svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/></svg>`
const muteOffIconSm = `<svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"/></svg>`
