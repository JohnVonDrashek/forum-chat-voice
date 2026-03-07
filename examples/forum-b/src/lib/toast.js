let toastId = 0

export function toast(message, type = 'info') {
  const container = document.getElementById('toast-container')
  if (!container) return

  const id = ++toastId
  const el = document.createElement('div')
  el.id = `toast-${id}`
  el.className = `toast toast-${type}`
  el.textContent = message
  container.appendChild(el)

  requestAnimationFrame(() => {
    el.classList.add('visible')
  })

  setTimeout(() => {
    el.classList.remove('visible')
    setTimeout(() => el.remove(), 300)
  }, 3000)
}

toast.success = (msg) => toast(msg, 'success')
toast.error = (msg) => toast(msg, 'error')
