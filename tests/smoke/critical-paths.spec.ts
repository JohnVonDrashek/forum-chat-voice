import { expect, test } from '@playwright/test';

// These tests verify critical infrastructure paths that can break silently.
// They run without authentication and check that endpoints respond correctly
// (not that business logic works — that's what e2e tests are for).

test.describe('Forumline API critical paths', () => {
  const BASE = 'https://app.forumline.net';

  test('health endpoint returns 200', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.status()).toBe(200);
  });

  test('SSE endpoint returns 401 (not 500) without auth', async ({ request }) => {
    // The SSE endpoint should reject unauthenticated requests with 401.
    // If it returns 500, a middleware wrapper is breaking http.Flusher.
    const res = await request.get(`${BASE}/api/events/stream`);
    expect(res.status()).not.toBe(500);
    expect(res.status()).toBe(401);
  });

  test('public API endpoints return non-5xx', async ({ request }) => {
    const res = await request.get(`${BASE}/api/forums`);
    expect(res.status()).toBeLessThan(500);
  });

  test('metrics endpoint is accessible', async ({ request }) => {
    const res = await request.get(`${BASE}/metrics`);
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('forumline_api_http_requests_total');
  });
});

test.describe('Hosted API critical paths', () => {
  const BASE = 'https://hosted.forumline.net';

  test('health endpoint returns 200', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.status()).toBe(200);
  });

  test('platform forums API returns non-5xx', async ({ request }) => {
    const res = await request.get(`${BASE}/api/platform/forums`);
    expect(res.status()).toBeLessThan(500);
  });
});

test.describe('Identity service critical paths', () => {
  test('health endpoint returns 200', async ({ request }) => {
    const res = await request.get('https://id.forumline.net/health');
    expect(res.status()).toBe(200);
  });

  test('JWKS endpoint returns valid JSON', async ({ request }) => {
    const res = await request.get('https://id.forumline.net/.well-known/jwks');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('keys');
  });
});

test.describe('Forum auto sign-in prerequisites', () => {
  test('testforum token-exchange returns 400 (not 500) without body', async ({ request }) => {
    // Token exchange should return 400 "token required" for empty requests.
    // If it returns 500, something is broken in the auth provider chain.
    const res = await request.post('https://testforum.forumline.net/api/forumline/auth/token-exchange', {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('token');
  });

  test('testforum config endpoint returns capabilities', async ({ request }) => {
    const res = await request.get('https://testforum.forumline.net/api/config');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('name');
    expect(body).toHaveProperty('capabilities');
  });
});
