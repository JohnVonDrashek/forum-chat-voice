/*
 * Sign In Page
 *
 * Redirects users to Forumline identity service for authentication.
 * The /api/forumline/auth endpoint redirects to id.forumline.net,
 * which handles the full OIDC flow and redirects back with a token.
 */

export function renderLogin(container) {
  container.innerHTML = `
    <div class="max-w-md mx-auto mt-12">
      <h1 class="text-2xl font-bold mb-6">Sign In</h1>
      <a href="/api/forumline/auth" class="block w-full py-3 text-center bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors">Sign in with Forumline</a>
      <p class="mt-4 text-sm text-slate-400 text-center">Don't have an account? <a href="https://app.forumline.net" class="text-indigo-400 hover:text-indigo-300">Create a Forumline account</a></p>
    </div>
  `
}
