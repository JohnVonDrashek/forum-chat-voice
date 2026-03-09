/**
 * Web Audio API ringtones for call states.
 * No audio files needed — generates tones procedurally.
 */

let audioCtx: AudioContext | null = null

function getAudioCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext()
  return audioCtx
}

/**
 * Play a repeating ringtone pattern.
 * Returns a stop function.
 */
export function playRingtone(type: 'incoming' | 'outgoing'): () => void {
  const ctx = getAudioCtx()
  let stopped = false
  let timeout: ReturnType<typeof setTimeout> | null = null
  let currentOsc: OscillatorNode | null = null
  let currentGain: GainNode | null = null

  function playTone(freq: number, duration: number): Promise<void> {
    return new Promise((resolve) => {
      if (stopped) { resolve(); return }

      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.value = 0.15
      osc.connect(gain)
      gain.connect(ctx.destination)

      currentOsc = osc
      currentGain = gain

      osc.start()
      timeout = setTimeout(() => {
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05)
        setTimeout(() => {
          osc.stop()
          osc.disconnect()
          gain.disconnect()
          currentOsc = null
          currentGain = null
          resolve()
        }, 50)
      }, duration)
    })
  }

  function pause(ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (stopped) { resolve(); return }
      timeout = setTimeout(resolve, ms)
    })
  }

  async function loop() {
    while (!stopped) {
      if (type === 'incoming') {
        // Classic double-ring pattern: ring-ring, pause
        await playTone(440, 200)
        await pause(100)
        await playTone(440, 200)
        await pause(2000)
      } else {
        // Ringback tone: single long tone, pause
        await playTone(440, 1000)
        await pause(3000)
      }
    }
  }

  // Resume audio context if suspended (browser autoplay policy)
  ctx.resume().then(loop)

  return () => {
    stopped = true
    if (timeout) clearTimeout(timeout)
    if (currentOsc) {
      try { currentOsc.stop() } catch {}
      currentOsc.disconnect()
    }
    if (currentGain) currentGain.disconnect()
  }
}
