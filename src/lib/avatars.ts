import { createAvatar } from '@dicebear/core'
import * as avataaars from '@dicebear/avataaars'
import * as shapes from '@dicebear/shapes'
import { supabase } from './supabase'

const BUCKET = 'avatars'

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
 * Upload a file (Blob/File) to Supabase Storage and return the public URL.
 */
export async function uploadAvatar(file: Blob | File, path: string): Promise<string | null> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type || 'image/png' })

  if (error) {
    console.error('Avatar upload failed:', error.message)
    return null
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}

/**
 * Generate a DiceBear avatar PNG and upload it to Supabase Storage.
 * Returns the public URL or null on failure.
 */
export async function uploadDefaultAvatar(
  seed: string,
  type: 'user' | 'thread'
): Promise<string | null> {
  try {
    const svg = generateSvg(seed, type)
    const pngBlob = await svgToPngBlob(svg)
    const folder = type === 'user' ? 'user' : 'thread'
    const path = `${folder}/${seed}/default.png`
    return await uploadAvatar(pngBlob, path)
  } catch (err) {
    console.error('Failed to generate default avatar:', err)
    return null
  }
}
