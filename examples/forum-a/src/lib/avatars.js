import { createAvatar } from '@dicebear/core'
import * as avataaars from '@dicebear/avataaars'
import * as shapes from '@dicebear/shapes'

function generateSvg(seed, type) {
  const avatar = createAvatar(type === 'user' ? avataaars : shapes, { seed, size: 256 })
  return avatar.toString()
}

function svgToPngBlob(svgString, size = 256) {
  return new Promise((resolve, reject) => {
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) { URL.revokeObjectURL(url); reject(new Error('No canvas context')); return }
      ctx.drawImage(img, 0, 0, size, size)
      URL.revokeObjectURL(url)
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG blob failed')), 'image/png')
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG load failed')) }
    img.src = url
  })
}

export async function uploadAvatar(file, path, accessToken) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('path', path)

  const res = await fetch('/api/avatars/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  })
  if (!res.ok) return null
  const data = await res.json()
  return data.url
}

export async function uploadDefaultAvatar(seed, type, accessToken) {
  try {
    const svg = generateSvg(seed, type)
    const pngBlob = await svgToPngBlob(svg)
    const folder = type === 'user' ? 'user' : 'thread'
    return await uploadAvatar(pngBlob, `${folder}/${seed}/default.png`, accessToken)
  } catch (err) {
    console.error('Failed to generate default avatar:', err)
    return null
  }
}
