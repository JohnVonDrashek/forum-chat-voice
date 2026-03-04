import type { SupabaseClient } from '@supabase/supabase-js'

export interface ProfileSearchResult {
  id: string
  username: string
  display_name: string | null
  avatar_url: string | null
}

/**
 * Search hub profiles by username or display name, excluding the given user.
 */
export async function searchProfiles(
  supabase: SupabaseClient,
  query: string,
  excludeUserId: string,
  limit = 10
): Promise<{ data: ProfileSearchResult[]; error: string | null }> {
  const { data: profiles, error } = await supabase
    .from('hub_profiles')
    .select('id, username, display_name, avatar_url')
    .neq('id', excludeUserId)
    .or(`username.ilike.%${query}%,display_name.ilike.%${query}%`)
    .limit(limit)

  if (error) {
    return { data: [], error: 'Failed to search profiles' }
  }

  return { data: profiles || [], error: null }
}

/**
 * Look up a single profile by ID.
 */
export async function getProfileById(
  supabase: SupabaseClient,
  userId: string
): Promise<{ data: ProfileSearchResult | null; error: string | null }> {
  const { data, error } = await supabase
    .from('hub_profiles')
    .select('id, username, display_name, avatar_url')
    .eq('id', userId)
    .single()

  if (error) {
    return { data: null, error: 'Profile not found' }
  }

  return { data, error: null }
}

/**
 * Fetch profiles for a list of user IDs.
 */
export async function getProfilesByIds(
  supabase: SupabaseClient,
  userIds: string[]
): Promise<Map<string, ProfileSearchResult>> {
  if (userIds.length === 0) return new Map()

  const { data: profiles } = await supabase
    .from('hub_profiles')
    .select('id, username, display_name, avatar_url')
    .in('id', userIds)

  return new Map(
    (profiles || []).map((p: ProfileSearchResult) => [p.id, p])
  )
}
