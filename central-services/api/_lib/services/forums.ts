import type { SupabaseClient } from '@supabase/supabase-js'
import { randomBytes, createHash } from 'crypto'

export interface ForumRegistrationInput {
  domain: string
  name: string
  api_base: string
  web_base: string
  capabilities?: string[]
  description?: string | null
  redirect_uris?: string[]
}

export interface ForumRegistrationResult {
  forum_id: string
  client_id: string
  client_secret: string
  approved: boolean
  message: string
}

/**
 * Check the user's forum registration quota (max 5).
 * Returns true if the user can register another forum.
 */
export async function checkForumQuota(
  supabase: SupabaseClient,
  ownerId: string
): Promise<{ allowed: boolean }> {
  const { count: forumCount } = await supabase
    .from('forumline_forums')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', ownerId)

  return { allowed: (forumCount ?? 0) < 5 }
}

/**
 * Check if a domain is already registered.
 */
export async function isDomainRegistered(
  supabase: SupabaseClient,
  domain: string
): Promise<boolean> {
  const { data: existing } = await supabase
    .from('forumline_forums')
    .select('id')
    .eq('domain', domain)
    .single()

  return !!existing
}

/**
 * Register a new forum with OAuth client credentials.
 * Performs quota check, domain uniqueness check, forum creation,
 * and OAuth credential generation as a logical unit.
 */
export async function registerForum(
  supabase: SupabaseClient,
  ownerId: string,
  input: ForumRegistrationInput
): Promise<{ data: ForumRegistrationResult | null; error: string | null; status?: number }> {
  // Enforce forum registration quota
  const { allowed } = await checkForumQuota(supabase, ownerId)
  if (!allowed) {
    return { data: null, error: 'Maximum of 5 forums per user', status: 403 }
  }

  // Check domain uniqueness
  if (await isDomainRegistered(supabase, input.domain)) {
    return { data: null, error: 'Forum with this domain is already registered', status: 409 }
  }

  // Create forum entry
  const { data: forum, error: forumError } = await supabase
    .from('forumline_forums')
    .insert({
      domain: input.domain,
      name: input.name,
      api_base: input.api_base,
      web_base: input.web_base,
      capabilities: input.capabilities || [],
      description: input.description || null,
      owner_id: ownerId,
      approved: false,
    })
    .select('id')
    .single()

  if (forumError || !forum) {
    return { data: null, error: 'Failed to register forum', status: 500 }
  }

  // Generate OAuth client credentials
  const clientId = randomBytes(16).toString('hex')
  const clientSecret = randomBytes(32).toString('hex')
  const clientSecretHash = createHash('sha256').update(clientSecret).digest('hex')

  const { error: clientError } = await supabase
    .from('forumline_oauth_clients')
    .insert({
      forum_id: forum.id,
      client_id: clientId,
      client_secret_hash: clientSecretHash,
      redirect_uris: input.redirect_uris || [`${input.web_base}/api/forumline/auth/callback`],
    })

  if (clientError) {
    // Rollback forum creation
    await supabase.from('forumline_forums').delete().eq('id', forum.id)
    return { data: null, error: 'Failed to create OAuth credentials', status: 500 }
  }

  return {
    data: {
      forum_id: forum.id,
      client_id: clientId,
      client_secret: clientSecret,
      approved: false,
      message: 'Forum registered. OAuth credentials generated. Forum requires approval before appearing in public listings.',
    },
    error: null,
  }
}
