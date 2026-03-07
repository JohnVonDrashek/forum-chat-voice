export function renderNotFound(container) {
  container.innerHTML = `
    <div class="gothic-box" style="margin-top:40px">
      <div class="gothic-box-header">~ Lost in the Void ~</div>
      <div class="gothic-box-content text-center" style="padding:32px">
        <div style="font-size:48px;font-family:var(--font-heading);color:var(--accent-purple);text-shadow:var(--glow-purple)">404</div>
        <p style="font-size:14px;color:var(--accent-pink);margin-top:8px">The page you seek does not exist in this realm.</p>
        <a href="/" class="btn btn-primary btn-small mt-4">Return Home</a>
      </div>
    </div>
  `
}
