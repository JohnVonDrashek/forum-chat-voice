import { $ } from '../lib/utils.js';
import { showToast } from './toast.js';

let selectedStatusEmoji = '&#x1F4BB;';

export function initStatusModal() {
  // Status button click handler
  $('statusBtn')?.addEventListener('click', () => {
    $('statusModal').classList.remove('hidden');
    $('statusInput').value = $('statusText').textContent;
    // Highlight current emoji
    document.querySelectorAll('.status-emoji-pick').forEach(p => {
      p.classList.toggle('selected', p.dataset.emoji === selectedStatusEmoji);
    });
  });

  // Status modal backdrop close
  $('statusModalBackdrop')?.addEventListener('click', () => {
    $('statusModal').classList.add('hidden');
  });

  // Status emoji pick handlers
  document.querySelectorAll('.status-emoji-pick').forEach(pick => {
    pick.addEventListener('click', () => {
      document.querySelectorAll('.status-emoji-pick').forEach(p => p.classList.remove('selected'));
      pick.classList.add('selected');
      selectedStatusEmoji = pick.dataset.emoji;
    });
  });

  // Status save handler
  $('statusSave')?.addEventListener('click', () => {
    $('statusEmoji').innerHTML = selectedStatusEmoji;
    $('statusText').textContent = $('statusInput').value || 'No status';
    $('statusModal').classList.add('hidden');
    showToast('Status updated');
  });

  // Status clear handler
  $('statusClear')?.addEventListener('click', () => {
    $('statusEmoji').innerHTML = '';
    $('statusText').textContent = 'Set a status';
    $('statusModal').classList.add('hidden');
  });
}
