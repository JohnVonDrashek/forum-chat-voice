import { ForumlineServer, ForumlineSupabaseAdapter } from '@johnvondrashek/forumline-server-sdk'
import type { ForumlineIdentity, ForumNotification } from '@johnvondrashek/forumline-protocol'
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

    async createOrLinkUser(identity: ForumlineIdentity, hubAccessToken: string | null): Promise<string> {
      const supabase = createClient(supabaseUrl, serviceRoleKey)

      // 1. Check if a local profile already has this forumline_id
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

      // 2. Get hub email and check for collision with existing local account
      let hubEmail: string | undefined
      if (hubAccessToken) {
        const hubSupabaseUrl = process.env.FORUMLINE_HUB_SUPABASE_URL
        const hubServiceKey = process.env.FORUMLINE_HUB_SERVICE_ROLE_KEY
        if (hubSupabaseUrl && hubServiceKey) {
          const hubSb = createClient(hubSupabaseUrl, hubServiceKey)
          const { data: { user: hubUser } } = await hubSb.auth.getUser(hubAccessToken)
          hubEmail = hubUser?.email || undefined
        }
      }

      if (hubEmail) {
        // Check if a local user with this email already exists
        const { data: localUsersByEmail } = await supabase.auth.admin.listUsers() as { data: { users: Array<{ email?: string; id: string }> } }
        const matchingUser = localUsersByEmail?.users?.find(
          u => u.email?.toLowerCase() === hubEmail!.toLowerCase()
        )
        if (matchingUser) {
          // Email collision — do NOT auto-link. User must link from Settings.
          const err = new Error('EMAIL_COLLISION: A local account with this email already exists. Sign in locally and connect Forumline from Settings.')
          err.name = 'EmailCollisionError'
          throw err
        }

        // No collision — create new local user with hub email
        const tempPassword = crypto.randomUUID()
        const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
          email: hubEmail,
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
      }

      // 3. Fallback: create user with forumline.local email
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

    async afterAuth({ userId }) {
      const supabase = createClient(supabaseUrl, serviceRoleKey)

      // Generate a Supabase session via magic link so the user is signed in
      const { data: userData } = await supabase.auth.admin.getUserById(userId)
      if (!userData?.user?.email) return undefined

      const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email: userData.user.email,
      })

      if (linkError || !linkData?.properties?.hashed_token) {
        console.error('[FLD:Forumline] Failed to generate magic link:', linkError)
        return undefined
      }

      // Verify the magic link server-side to get session tokens
      const anonSb = createClient(supabaseUrl, supabaseAnonKey)
      const { data: otpData, error: otpError } = await anonSb.auth.verifyOtp({
        token_hash: linkData.properties.hashed_token,
        type: 'magiclink',
      })

      if (otpError || !otpData?.session) {
        console.error('[FLD:Forumline] Failed to verify OTP:', otpError)
        return undefined
      }

      // Redirect with session in URL hash — Supabase client auto-detects it
      const { access_token, refresh_token } = otpData.session
      return `${siteUrl}/#access_token=${access_token}&refresh_token=${refresh_token}&type=bearer`
    },

    async getNotifications(userId: string): Promise<ForumNotification[]> {
      const supabase = createClient(supabaseUrl, serviceRoleKey)
      const { data: notifications } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50)

      return (notifications || []).map(n => adapter.notificationToProtocol(n))
    },

    async getUnreadCounts(userId: string) {
      const supabase = createClient(supabaseUrl, serviceRoleKey)

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

      return {
        notifications: notifCount ?? 0,
        chat_mentions: chatMentionCount ?? 0,
        dms: 0, // Hub DM counts are handled client-side
      }
    },

    async markNotificationRead(notificationId: string, userId: string) {
      const supabase = createClient(supabaseUrl, serviceRoleKey)
      await supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', notificationId)
        .eq('user_id', userId)
    },
  })

  return _server
}
