import { ForumlineServer, ForumlineSupabaseAdapter } from '@forumline/server-sdk'
import type { ForumlineIdentity, ForumNotification } from '@forumline/protocol'
import { createClient } from '@supabase/supabase-js'

const DOMAIN = 'forum-chat-voice.vercel.app'

let _server: ForumlineServer | null = null

/** Get or create the shared ForumlineServer instance for this demo forum */
export function getForumlineServer(): ForumlineServer {
  if (_server) return _server

  const supabaseUrl = process.env.VITE_SUPABASE_URL!
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const siteUrl = process.env.VITE_SITE_URL || `https://${DOMAIN}`

  const adapter = new ForumlineSupabaseAdapter({ domain: DOMAIN })

  _server = new ForumlineServer({
    name: 'Forumline Demo',
    domain: DOMAIN,
    icon_url: '/forum.svg',
    api_base: `https://${DOMAIN}/api/forumline`,
    web_base: `https://${DOMAIN}`,
    capabilities: ['threads', 'chat', 'voice', 'notifications'],
    siteUrl,

    hub: {
      url: process.env.FORUMLINE_HUB_URL!,
      clientId: process.env.FORUMLINE_CLIENT_ID!,
      clientSecret: process.env.FORUMLINE_CLIENT_SECRET!,
    },

    async authenticateRequest(token: string): Promise<string | null> {
      const supabase = createClient(supabaseUrl, supabaseAnonKey)
      const { data: { user }, error } = await supabase.auth.getUser(token)
      if (error || !user) return null
      return user.id
    },

    async createOrLinkUser(identity: ForumlineIdentity): Promise<string> {
      const supabase = createClient(supabaseUrl, serviceRoleKey)

      // Check if a local profile already has this forumline_id
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('forumline_id', identity.forumline_id)
        .single()

      if (existingProfile) {
        await supabase
          .from('profiles')
          .update({
            display_name: identity.display_name,
            avatar_url: identity.avatar_url || undefined,
          })
          .eq('id', existingProfile.id)
        return existingProfile.id
      }

      // Create a new local auth user
      const tempPassword = crypto.randomUUID()
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email: `${identity.username}@forumline.local`,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
          username: identity.username,
          display_name: identity.display_name,
          forumline_id: identity.forumline_id,
        },
      })

      if (createError || !newUser.user) {
        throw new Error(`Failed to create local user: ${createError?.message}`)
      }

      await supabase
        .from('profiles')
        .update({ forumline_id: identity.forumline_id })
        .eq('id', newUser.user.id)

      return newUser.user.id
    },

    async getNotifications(userId: string): Promise<ForumNotification[]> {
      const supabase = createClient(supabaseUrl, supabaseAnonKey)
      const { data: notifications } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50)

      return (notifications || []).map(n => adapter.notificationToProtocol(n))
    },

    async getUnreadCounts(userId: string) {
      const supabase = createClient(supabaseUrl, supabaseAnonKey)

      const { count: notifCount } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('read', false)
        .neq('type', 'chat_mention')

      const { count: chatMentionCount } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('read', false)
        .eq('type', 'chat_mention')

      const { count: dmCount } = await supabase
        .from('direct_messages')
        .select('*', { count: 'exact', head: true })
        .eq('recipient_id', userId)
        .eq('read', false)

      return {
        notifications: notifCount ?? 0,
        chat_mentions: chatMentionCount ?? 0,
        dms: dmCount ?? 0,
      }
    },

    async markNotificationRead(notificationId: string, userId: string) {
      const supabase = createClient(supabaseUrl, supabaseAnonKey)
      await supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', notificationId)
        .eq('user_id', userId)
    },
  })

  return _server
}
