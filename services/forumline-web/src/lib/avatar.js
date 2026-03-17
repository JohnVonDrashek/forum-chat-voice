import * as avataaars from '@dicebear/avataaars';
import { createAvatar } from '@dicebear/core';
import * as shapes from '@dicebear/shapes';

const cache = new Map();

/**
 * Generate a deterministic avatar data URI from a seed.
 * @param {string} seed - User ID, thread ID, forum domain, etc.
 * @param {'avataaars'|'shapes'} [style='avataaars'] - avataaars for people, shapes for forums/threads
 * @returns {string} data URI
 */
export function avatarUrl(seed, style = 'avataaars') {
  const key = `${style}:${seed}`;
  let uri = cache.get(key);
  if (uri) return uri;
  const avatar = createAvatar(style === 'shapes' ? shapes : avataaars, { seed, size: 128 });
  uri = avatar.toDataUri();
  cache.set(key, uri);
  return uri;
}
