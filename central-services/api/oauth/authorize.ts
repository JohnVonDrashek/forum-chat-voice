import type { VercelRequest, VercelResponse } from '@vercel/node'
import { randomBytes } from 'crypto'
import { getHubSupabase, handleCors } from '../_lib/supabase.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { client_id, redirect_uri, state } = req.query as Record<string, string>

  if (!client_id || !redirect_uri || !state) {
    return res.status(400).json({ error: 'client_id, redirect_uri, and state are required' })
  }

  const supabase = getHubSupabase()

  // Validate client_id and redirect_uri
  const { data: client } = await supabase
    .from('forumline_oauth_clients')
    .select('id, forum_id, redirect_uris')
    .eq('client_id', client_id)
    .single()

  if (!client) {
    return res.status(400).json({ error: 'Invalid client_id' })
  }

  const allowedUris: string[] = client.redirect_uris || []
  if (!allowedUris.includes(redirect_uri)) {
    return res.status(400).json({ error: 'Invalid redirect_uri' })
  }

  // Fetch forum name for display
  const { data: forum } = await supabase
    .from('forumline_forums')
    .select('name, domain')
    .eq('id', client.forum_id)
    .single()

  const forumName = forum?.name || forum?.domain || 'a forum'

  // Check if user is authenticated via Bearer token or access_token query param
  const authHeader = req.headers.authorization
  let userId: string | null = null

  if (authHeader?.startsWith('Bearer ')) {
    const jwt = authHeader.slice(7)
    const { createClient } = await import('@supabase/supabase-js')
    const anonClient = createClient(
      process.env.HUB_SUPABASE_URL!,
      process.env.HUB_SUPABASE_ANON_KEY!
    )
    const { data: { user } } = await anonClient.auth.getUser(jwt)
    if (user) userId = user.id
  }

  if (!userId && req.query.access_token) {
    const { createClient } = await import('@supabase/supabase-js')
    const anonClient = createClient(
      process.env.HUB_SUPABASE_URL!,
      process.env.HUB_SUPABASE_ANON_KEY!
    )
    const { data: { user } } = await anonClient.auth.getUser(req.query.access_token as string)
    if (user) userId = user.id
  }

  if (!userId) {
    // Not authenticated — serve HTML login/signup page
    return serveLoginPage(res, { client_id, redirect_uri, state, forumName })
  }

  // Generate authorization code
  const code = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()

  const { error } = await supabase
    .from('forumline_auth_codes')
    .insert({
      code,
      user_id: userId,
      forum_id: client.forum_id,
      redirect_uri,
      expires_at: expiresAt,
    })

  if (error) {
    return res.status(500).json({ error: 'Failed to generate authorization code' })
  }

  await supabase
    .from('forumline_memberships')
    .upsert(
      { user_id: userId, forum_id: client.forum_id },
      { onConflict: 'user_id,forum_id' }
    )

  const redirectUrl = new URL(redirect_uri)
  redirectUrl.searchParams.set('code', code)
  redirectUrl.searchParams.set('state', state)

  return res.redirect(302, redirectUrl.toString())
}

function serveLoginPage(
  res: VercelResponse,
  params: { client_id: string; redirect_uri: string; state: string; forumName: string }
) {
  const { client_id, redirect_uri, state, forumName } = params
  const authorizeUrl = `/api/oauth/authorize?client_id=${encodeURIComponent(client_id)}&redirect_uri=${encodeURIComponent(redirect_uri)}&state=${encodeURIComponent(state)}`

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sign in to Forumline</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0f1117;
    color: #e2e8f0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .container {
    width: 100%;
    max-width: 400px;
    padding: 24px;
  }
  .card {
    background: #1a1d2e;
    border: 1px solid #2d3348;
    border-radius: 12px;
    padding: 32px;
  }
  .logo {
    text-align: center;
    margin-bottom: 8px;
    font-size: 32px;
  }
  h1 {
    text-align: center;
    font-size: 22px;
    font-weight: 600;
    margin-bottom: 4px;
  }
  .subtitle {
    text-align: center;
    color: #94a3b8;
    font-size: 14px;
    margin-bottom: 24px;
  }
  .forum-name {
    color: #818cf8;
    font-weight: 500;
  }
  .tabs {
    display: flex;
    gap: 0;
    margin-bottom: 24px;
    border-bottom: 1px solid #2d3348;
  }
  .tab {
    flex: 1;
    padding: 10px;
    text-align: center;
    font-size: 14px;
    font-weight: 500;
    color: #94a3b8;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: all 0.15s;
    background: none;
    border-top: none;
    border-left: none;
    border-right: none;
  }
  .tab.active {
    color: #818cf8;
    border-bottom-color: #818cf8;
  }
  .form { display: none; }
  .form.active { display: block; }
  label {
    display: block;
    font-size: 13px;
    font-weight: 500;
    color: #94a3b8;
    margin-bottom: 6px;
  }
  input {
    width: 100%;
    padding: 10px 12px;
    background: #0f1117;
    border: 1px solid #2d3348;
    border-radius: 8px;
    color: #e2e8f0;
    font-size: 14px;
    outline: none;
    transition: border-color 0.15s;
    margin-bottom: 16px;
  }
  input:focus {
    border-color: #818cf8;
  }
  input::placeholder {
    color: #475569;
  }
  button[type="submit"] {
    width: 100%;
    padding: 10px;
    background: #6366f1;
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }
  button[type="submit"]:hover {
    background: #4f46e5;
  }
  button[type="submit"]:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .error {
    background: #7f1d1d33;
    border: 1px solid #991b1b;
    color: #fca5a5;
    padding: 10px 12px;
    border-radius: 8px;
    font-size: 13px;
    margin-bottom: 16px;
    display: none;
  }
  .error.visible { display: block; }
</style>
</head>
<body>
<div class="container">
  <div class="card">
    <div class="logo">\u{1F310}</div>
    <h1>Forumline</h1>
    <p class="subtitle">Sign in to connect with <span class="forum-name">${escapeHtml(forumName)}</span></p>

    <div class="tabs">
      <button class="tab active" onclick="switchTab('login')">Sign In</button>
      <button class="tab" onclick="switchTab('signup')">Create Account</button>
    </div>

    <div class="error" id="error"></div>

    <form id="login-form" class="form active" onsubmit="return handleLogin(event)">
      <label for="login-email">Email</label>
      <input type="email" id="login-email" placeholder="you@example.com" required>
      <label for="login-password">Password</label>
      <input type="password" id="login-password" placeholder="Password" required>
      <button type="submit" id="login-btn">Sign In</button>
    </form>

    <form id="signup-form" class="form" onsubmit="return handleSignup(event)">
      <label for="signup-email">Email</label>
      <input type="email" id="signup-email" placeholder="you@example.com" required>
      <label for="signup-username">Username</label>
      <input type="text" id="signup-username" placeholder="your_username" required minlength="3" maxlength="30" pattern="[a-zA-Z0-9_-]+">
      <label for="signup-password">Password</label>
      <input type="password" id="signup-password" placeholder="Password (min 6 chars)" required minlength="6">
      <button type="submit" id="signup-btn">Create Account & Connect</button>
    </form>
  </div>
</div>

<script>
  const AUTHORIZE_URL = ${JSON.stringify(authorizeUrl)};
  const HUB_ORIGIN = location.origin;

  function switchTab(tab) {
    document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', i === (tab === 'login' ? 0 : 1)));
    document.getElementById('login-form').classList.toggle('active', tab === 'login');
    document.getElementById('signup-form').classList.toggle('active', tab === 'signup');
    hideError();
  }

  function showError(msg) {
    const el = document.getElementById('error');
    el.textContent = msg;
    el.classList.add('visible');
  }

  function hideError() {
    document.getElementById('error').classList.remove('visible');
  }

  async function handleLogin(e) {
    e.preventDefault();
    hideError();
    const btn = document.getElementById('login-btn');
    btn.disabled = true;
    btn.textContent = 'Signing in...';
    try {
      const res = await fetch(HUB_ORIGIN + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: document.getElementById('login-email').value,
          password: document.getElementById('login-password').value,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      window.location.href = AUTHORIZE_URL + '&access_token=' + encodeURIComponent(data.session.access_token);
    } catch (err) {
      showError(err.message);
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  }

  async function handleSignup(e) {
    e.preventDefault();
    hideError();
    const btn = document.getElementById('signup-btn');
    btn.disabled = true;
    btn.textContent = 'Creating account...';
    try {
      const res = await fetch(HUB_ORIGIN + '/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: document.getElementById('signup-email').value,
          username: document.getElementById('signup-username').value,
          password: document.getElementById('signup-password').value,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Signup failed');
      window.location.href = AUTHORIZE_URL + '&access_token=' + encodeURIComponent(data.session.access_token);
    } catch (err) {
      showError(err.message);
      btn.disabled = false;
      btn.textContent = 'Create Account & Connect';
    }
  }
</script>
</body>
</html>`

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  return res.status(200).send(html)
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
