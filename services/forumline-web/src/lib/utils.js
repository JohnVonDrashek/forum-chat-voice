// ========== UTILITY FUNCTIONS ==========

import { escapeHtml } from './markdown.js';

// DOM shorthand
export const $ = id => document.getElementById(id);

// Pluralization helper
export function plural(count, word) {
  if (count === 1) return `${count} ${word}`;
  if (word === 'reply') return `${count} replies`;
  return `${count} ${word}s`;
}

// Highlight search match with <mark> tags
export function highlightMatch(text, query) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return escapeHtml(text);
  return escapeHtml(text.substring(0, idx)) + '<mark>' + escapeHtml(text.substring(idx, idx + query.length)) + '</mark>' + escapeHtml(text.substring(idx + query.length));
}

// Animated counter (ease-out cubic)
export function animateCounter(el, target) {
  const duration = 600;
  const start = parseInt(el.textContent) || 0;
  const diff = target - start;
  if (diff === 0) return;
  const startTime = performance.now();

  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(start + diff * eased);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
