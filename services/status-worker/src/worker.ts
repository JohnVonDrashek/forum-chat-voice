const STATUS_PAGE_URL = "https://status.forumline.net";

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Don't redirect the status page itself (avoid loops)
    if (url.hostname === "status.forumline.net") {
      return fetch(request);
    }

    // Let Uptimer health checks through so they see the real origin status
    const ua = request.headers.get("user-agent") || "";
    if (ua.startsWith("Uptimer/")) {
      return fetch(request);
    }

    // Proxy to the origin (Cloudflare Tunnel)
    try {
      const response = await fetch(request);

      // If the tunnel is down, Cloudflare returns 502/503/521/522/523/524
      if (isOriginDown(response.status)) {
        return redirect(url);
      }

      return response;
    } catch {
      // Network error — tunnel completely unreachable
      return redirect(url);
    }
  },
};

function isOriginDown(status: number): boolean {
  return [502, 503, 520, 521, 522, 523, 524, 525, 526, 530].includes(status);
}

function redirect(originalUrl: URL): Response {
  const target = new URL(STATUS_PAGE_URL);
  target.searchParams.set("from", originalUrl.hostname);
  return Response.redirect(target.toString(), 302);
}
