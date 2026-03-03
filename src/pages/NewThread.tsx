import { useState, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuth } from '../lib/auth'
import { getDataProvider } from '../lib/data-provider'
import { uploadAvatar, uploadDefaultAvatar } from '../lib/avatars'
import Avatar from '../components/Avatar'
import ImageCropModal from '../components/ImageCropModal'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import Card from '../components/ui/Card'
import { queryKeys, fetchers, queryOptions } from '../lib/queries'

const newThreadSchema = z.object({
  title: z.string().min(5, 'Title must be at least 5 characters'),
  content: z.string().min(10, 'Content must be at least 10 characters'),
})

type NewThreadFormData = z.infer<typeof newThreadSchema>

export default function NewThread() {
  const { categorySlug } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { data: category } = useQuery({
    queryKey: queryKeys.category(categorySlug!),
    queryFn: () => fetchers.category(categorySlug!),
    enabled: !!categorySlug,
    ...queryOptions.static,
  })
  const [threadImageBlob, setThreadImageBlob] = useState<Blob | null>(null)
  const [threadImagePreview, setThreadImagePreview] = useState<string | null>(null)
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<NewThreadFormData>({
    resolver: zodResolver(newThreadSchema),
  })

  const submitMutation = useMutation({
    mutationFn: async (data: NewThreadFormData) => {
      if (!user || !category) throw new Error('Not authenticated')

      // Create slug from title
      const slug = data.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 50)

      const dp = getDataProvider()

      // Create thread
      const thread = await dp.createThread({
        category_id: category.id,
        author_id: user.id,
        title: data.title,
        slug,
      })

      if (!thread) throw new Error('Failed to create thread')

      // Create first post
      await dp.createPost({
        thread_id: thread.id,
        author_id: user.id,
        content: data.content,
      })

      // Upload thread image
      if (threadImageBlob) {
        const imageUrl = await uploadAvatar(threadImageBlob, `thread/${thread.id}/custom.png`)
        if (imageUrl) {
          await dp.updateThread(thread.id, { image_url: imageUrl })
        }
      } else {
        const imageUrl = await uploadDefaultAvatar(thread.id, 'thread')
        if (imageUrl) {
          await dp.updateThread(thread.id, { image_url: imageUrl })
        }
      }

      return thread
    },
    onSuccess: (thread) => {
      toast.success('Thread created')
      navigate(`/t/${thread.id}`)
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to create thread')
    },
  })

  const onSubmit = (data: NewThreadFormData) => {
    if (!user || !category) return
    submitMutation.mutate(data)
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

        <div aria-live="polite">
          {submitMutation.error && (
            <div role="alert" className="mt-4 rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
              {submitMutation.error.message}
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
          <div>
            <label htmlFor="title" className="block text-sm font-medium text-slate-300">
              Title
            </label>
            <Input
              type="text"
              id="title"
              {...register('title')}
              className="mt-1 block w-full"
              placeholder="What's on your mind?"
            />
            {errors.title && (
              <p className="text-red-400 text-sm mt-1">{errors.title.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="content" className="block text-sm font-medium text-slate-300">
              Content
            </label>
            <textarea
              id="content"
              {...register('content')}
              rows={8}
              className="mt-1 block w-full resize-none rounded-lg border border-slate-600 bg-slate-700 px-4 py-3 text-white placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="Share your thoughts..."
            />
            {errors.content && (
              <p className="text-red-400 text-sm mt-1">{errors.content.message}</p>
            )}
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
              disabled={submitMutation.isPending}
            >
              {submitMutation.isPending ? 'Creating...' : 'Create Thread'}
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
