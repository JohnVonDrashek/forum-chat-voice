import { createAvatar } from '@dicebear/core'
import * as avataaars from '@dicebear/avataaars'
import * as shapes from '@dicebear/shapes'

/**
 * Generate a DiceBear SVG string for a given seed.
 */
function generateSvg(seed: string, type: 'user' | 'thread'): string {
  const avatar = createAvatar(type === 'user' ? avataaars : shapes, {
    seed,
    size: 256,
  })
  return avatar.toString()
}

/**
 * Convert an SVG string to a PNG Blob using an offscreen canvas.
 */
function svgToPngBlob(svgString: string, size: number = 256): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        URL.revokeObjectURL(url)
        reject(new Error('Failed to get canvas context'))
        return
      }
      ctx.drawImage(img, 0, 0, size, size)
      URL.revokeObjectURL(url)
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Failed to create PNG blob'))
      }, 'image/png')
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load SVG image'))
    }
    img.src = url
  })
}

/**
 * Upload a file to R2 via the Go avatar upload endpoint.
 * Returns the public URL or null on failure.
 */
export async function uploadAvatar(file: Blob | File, path: string, accessToken: string): Promise<string | null> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('path', path)

  const res = await fetch('/api/avatars/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  })

  if (!res.ok) {
    console.error('Avatar upload failed:', res.status, await res.text())
    return null
  }

  const data = await res.json()
  return data.url
}

/**
 * Generate a DiceBear avatar PNG and upload it.
 * Returns the public URL or null on failure.
 */
export async function uploadDefaultAvatar(
  seed: string,
  type: 'user' | 'thread',
  accessToken: string
): Promise<string | null> {
  try {
    const svg = generateSvg(seed, type)
    const pngBlob = await svgToPngBlob(svg)
    const folder = type === 'user' ? 'user' : 'thread'
    const path = `${folder}/${seed}/default.png`
    return await uploadAvatar(pngBlob, path, accessToken)
  } catch (err) {
    console.error('Failed to generate default avatar:', err)
    return null
  }
}
