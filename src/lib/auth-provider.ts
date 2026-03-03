/**
 * AuthProvider Interface — Abstract auth layer for Forumline forums.
 *
 * Decouples the app from any specific auth backend (Supabase Auth, custom OAuth, etc.).
 * Each forum implementation provides its own auth provider.
 */

export interface AppUser {
  id: string
  email: string
  username?: string
  avatar?: string
  user_metadata?: {
    username?: string
  }
}

export interface AuthSession {
  access_token: string
  user: AppUser
}

export type AuthStateEvent =
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'TOKEN_REFRESHED'
  | 'PASSWORD_RECOVERY'
  | 'INITIAL_SESSION'

export type AuthCallback = (event: AuthStateEvent, session: AuthSession | null) => void
export type Unsubscribe = () => void

export interface ForumAuthProvider {
  /** Sign in with email and password */
  signIn(email: string, password: string): Promise<{ error: Error | null }>

  /** Sign up with email, password, and username */
  signUp(email: string, password: string, username: string): Promise<{ error: Error | null; userId?: string }>

  /** Sign out the current user */
  signOut(): Promise<void>

  /** Sign in with a third-party OAuth provider */
  signInWithOAuth(provider: string): Promise<void>

  /** Send a password reset email */
  resetPassword(email: string): Promise<{ error: Error | null }>

  /** Update the current user's password */
  updatePassword(newPassword: string): Promise<{ error: Error | null }>

  /** Get the current session (if any) */
  getSession(): Promise<AuthSession | null>

  /** Get the raw underlying user object (provider-specific) */
  getRawUser(): Promise<{ id: string; email?: string; user_metadata?: Record<string, unknown> } | null>

  /** Listen for auth state changes */
  onAuthStateChange(callback: AuthCallback): Unsubscribe
}

// ============================================================================
// Provider Registry
// ============================================================================

let _authProvider: ForumAuthProvider | null = null

/** Set the active auth provider (called once at app startup) */
export function setAuthProvider(provider: ForumAuthProvider): void {
  _authProvider = provider
}

/** Get the active auth provider */
export function getAuthProvider(): ForumAuthProvider {
  if (!_authProvider) {
    throw new Error(
      'ForumAuthProvider not initialized. Call setAuthProvider() before using auth operations.'
    )
  }
  return _authProvider
}
