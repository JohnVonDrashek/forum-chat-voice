import { $ } from '../lib/utils.js';

let confettiAnimationId = null;

export function fireConfetti() {
  // Cancel any existing confetti animation to prevent flickering
  if (confettiAnimationId) {
    cancelAnimationFrame(confettiAnimationId);
    confettiAnimationId = null;
  }

  const canvas = $('confettiCanvas');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');
  const colors = ['#6ec6ff', '#1a8dff', '#ff6b6b', '#66e066', '#ffd700', '#ff69b4', '#764ba2'];
  const particles = [];

  for (let i = 0; i < 120; i++) {
    particles.push({
      x: window.innerWidth / 2 + (Math.random() - 0.5) * 200,
      y: window.innerHeight / 2,
      vx: (Math.random() - 0.5) * 16,
      vy: -Math.random() * 18 - 4,
      w: Math.random() * 8 + 4,
      h: Math.random() * 6 + 3,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * 360,
      rotSpeed: (Math.random() - 0.5) * 12,
      gravity: 0.3 + Math.random() * 0.2,
    });
  }

  let frame = 0;
  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    particles.forEach(p => {
      p.x += p.vx;
      p.vy += p.gravity;
      p.y += p.vy;
      p.rotation += p.rotSpeed;
      p.vx *= 0.99;
      if (p.y < canvas.height + 50) {
        alive = true;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, 1 - frame / 120);
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
    });
    frame++;
    if (alive && frame < 150) {
      confettiAnimationId = requestAnimationFrame(animate);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      confettiAnimationId = null;
    }
  }
  animate();
}
