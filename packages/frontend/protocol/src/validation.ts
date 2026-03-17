/*
 * Input Validation Rules
 *
 * Enforces the business rules for user-submitted data shared across all Forumline clients and servers.
 *
 * It must:
 * - Validate usernames (3-30 chars, alphanumeric with hyphens/underscores) to keep identities clean and URL-safe across the network
 * - Enforce password strength requirements (8+ chars, letters and numbers) to protect user accounts
 * - Validate email format for account registration and recovery
 * - Cap message length (1-4000 chars) to prevent abuse while allowing meaningful content
 * - Require HTTPS for forum URLs to ensure secure communication between forums and the Forumline app
 */

import { z } from 'zod';

/** Username: 3-30 characters, letters/numbers/underscores/hyphens */
export const usernameSchema = z
  .string()
  .min(3, 'Username must be at least 3 characters')
  .max(30, 'Username must be at most 30 characters')
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    'Username may only contain letters, numbers, hyphens, and underscores',
  );

/** Password: at least 8 characters, at least one letter and one number */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[a-zA-Z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

/** Email address */
export const emailSchema = z.string().email('Please enter a valid email address');

/** Message content: 1-4000 characters */
export const messageContentSchema = z
  .string()
  .min(1, 'Message cannot be empty')
  .max(4000, 'Message cannot exceed 4000 characters');

/** Forum URL: must be HTTPS */
export const forumUrlSchema = z
  .string()
  .url('Please enter a valid URL')
  .startsWith('https://', 'URL must use HTTPS');
