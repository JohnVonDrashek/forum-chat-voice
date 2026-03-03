import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { uploadAvatar, uploadDefaultAvatar } from '../lib/avatars'
import Avatar from '../components/Avatar'
import ImageCropModal from '../components/ImageCropModal'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import Card from '../components/ui/Card'
import type { Category } from '../types'

export default function NewThread() {
  const { categorySlug } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [category, setCategory] = useState<Category | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [threadImageBlob, setThreadImageBlob] = useState<Blob | null>(null)
  const [threadImagePreview, setThreadImagePreview] = useState<string | null>(null)
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const fetchCategory = async () => {
      const { data } = await supabase
        .from('categories')
        .select('*')
        .eq('slug', categorySlug!)
        .single()
      if (data) setCategory(data)
    }

    fetchCategory()
  }, [categorySlug])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!user || !category) return

    if (title.length < 5) {
      setError('Title must be at least 5 characters')
      return
    }

    if (content.length < 10) {
      setError('Content must be at least 10 characters')
      return
    }

    setSubmitting(true)
    setError('')

    // Create slug from title
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50)

    // Create thread
    const { data: thread, error: threadError } = await supabase
      .from('threads')
      .insert({
        category_id: category.id,
        author_id: user.id,
        title,
        slug,
        post_count: 1,
        last_post_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (threadError) {
      setError(threadError.message)
      setSubmitting(false)
      return
    }

    // Create first post
    const { error: postError } = await supabase.from('posts').insert({
      thread_id: thread.id,
      author_id: user.id,
      content,
    })

    if (postError) {
      setError(postError.message)
      setSubmitting(false)
      return
    }

    // Upload thread image
    if (threadImageBlob) {
      // User selected a custom image — upload and update synchronously before navigating
      const imageUrl = await uploadAvatar(threadImageBlob, `thread/${thread.id}/custom.png`)
      if (imageUrl) {
        await supabase.from('threads').update({ image_url: imageUrl }).eq('id', thread.id)
      }
    } else {
      // No custom image — generate and upload a default DiceBear thread image
      const imageUrl = await uploadDefaultAvatar(thread.id, 'thread')
      if (imageUrl) {
        await supabase.from('threads').update({ image_url: imageUrl }).eq('id', thread.id)
      }
    }

    navigate(`/t/${thread.id}`)
  }

  if (!category) {
    return (
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-2xl font-bold text-white">Category not found</h1>
        <Link to="/" className="mt-4 inline-block text-indigo-400 hover:text-indigo-300">
          Go back home
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl">
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-2 text-sm text-slate-400">
        <Link to="/" className="hover:text-white">Home</Link>
        <span>/</span>
        <Link to={`/c/${category.slug}`} className="hover:text-white">{category.name}</Link>
        <span>/</span>
        <span className="text-white">New Thread</span>
      </div>

      <Card className="p-6">
        <h1 className="text-2xl font-bold text-white">Start a new discussion</h1>
        <p className="mt-1 text-slate-400">in {category.name}</p>

        {/* Optional thread image */}
        <div className="mt-4 flex items-center gap-4">
          <Avatar
            seed={threadImagePreview ? '' : 'placeholder'}
            type="thread"
            avatarUrl={threadImagePreview}
            className="h-16 w-16 shrink-0"
          />
          <div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700"
            >
              {threadImagePreview ? 'Change Image' : 'Add Thread Image'}
            </button>
            {threadImagePreview && (
              <button
                type="button"
                onClick={() => {
                  setThreadImageBlob(null)
                  setThreadImagePreview(null)
                }}
                className="ml-2 text-sm text-slate-500 hover:text-red-400"
              >
                Remove
              </button>
            )}
            <p className="mt-1 text-xs text-slate-500">Optional — a default image will be generated if none is provided</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) {
                const reader = new FileReader()
                reader.onload = () => setCropImageSrc(reader.result as string)
                reader.readAsDataURL(file)
              }
              e.target.value = ''
            }}
          />
        </div>

        {error && (
          <div className="mt-4 rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="title" className="block text-sm font-medium text-slate-300">
              Title
            </label>
            <Input
              type="text"
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 block w-full"
              placeholder="What's on your mind?"
              required
            />
          </div>

          <div>
            <label htmlFor="content" className="block text-sm font-medium text-slate-300">
              Content
            </label>
            <textarea
              id="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={8}
              className="mt-1 block w-full resize-none rounded-lg border border-slate-600 bg-slate-700 px-4 py-3 text-white placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="Share your thoughts..."
              required
            />
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="rounded-lg border border-slate-600 px-4 py-2 text-slate-300 hover:bg-slate-700"
            >
              Cancel
            </button>
            <Button
              type="submit"
              disabled={submitting}
            >
              {submitting ? 'Creating...' : 'Create Thread'}
            </Button>
          </div>
        </form>
      </Card>

      {cropImageSrc && (
        <ImageCropModal
          imageSrc={cropImageSrc}
          onCrop={(blob) => {
            setThreadImageBlob(blob)
            setThreadImagePreview(URL.createObjectURL(blob))
            setCropImageSrc(null)
          }}
          onCancel={() => setCropImageSrc(null)}
        />
      )}
    </div>
  )
}
