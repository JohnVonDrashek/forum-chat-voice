/**
 * Gothic avatar renderer.
 */

export function avatarHTML(opts = {}) {
  const { seed = '', type = 'user', size = 36, avatarUrl = null, showGlobe = false, className = '' } = opts
  const sizeStyle = `width:${size}px;height:${size}px;min-width:${size}px;`

  const fallback = `<div class="avatar-fallback ${className}" style="${sizeStyle}">
    <svg style="width:50%;height:50%" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  </div>`

  const globe = showGlobe ? `<div class="avatar-globe">
    <svg style="width:10px;height:10px" fill="none" viewBox="0 0 24 24" stroke="white" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
    </svg>
  </div>` : ''

  if (avatarUrl) {
    return `<div class="relative inline-flex" style="flex-shrink:0">
      <img src="${avatarUrl}" alt="" class="avatar ${className}" style="${sizeStyle}" />
      ${globe}
    </div>`
  }

  return `<div class="relative inline-flex" style="flex-shrink:0">${fallback}${globe}</div>`
}
