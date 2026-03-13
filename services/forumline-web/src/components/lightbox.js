import { $ } from '../lib/utils.js';

export function openLightbox(src) {
  $('lightboxImg').src = src;
  $('lightbox').classList.remove('hidden');
}

export function closeLightbox() {
  $('lightbox').classList.add('hidden');
}

export function initLightbox() {
  $('lightboxBackdrop')?.addEventListener('click', closeLightbox);
  $('lightboxClose')?.addEventListener('click', closeLightbox);
}
