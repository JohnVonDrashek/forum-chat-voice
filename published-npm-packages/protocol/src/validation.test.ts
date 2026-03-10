import { describe, expect, it } from 'vitest'
import {
  usernameSchema,
  passwordSchema,
  emailSchema,
  messageContentSchema,
  forumUrlSchema,
} from './validation.js'

describe('usernameSchema', () => {
  it('accepts valid usernames', () => {
    const valid = ['abc', 'user_name', 'user-name', 'User123', 'a-b', 'a_b', 'aaa']
    for (const name of valid) {
      expect(usernameSchema.safeParse(name).success, `${name} should be valid`).toBe(true)
    }
  })

  it('rejects too short', () => {
    expect(usernameSchema.safeParse('ab').success).toBe(false)
    expect(usernameSchema.safeParse('').success).toBe(false)
  })

  it('rejects too long', () => {
    expect(usernameSchema.safeParse('a'.repeat(31)).success).toBe(false)
  })

  it('accepts max length', () => {
    expect(usernameSchema.safeParse('a'.repeat(30)).success).toBe(true)
  })

  it('rejects invalid characters', () => {
    const invalid = ['has space', 'has.dot', 'has@sign', 'has!bang', 'has/slash']
    for (const name of invalid) {
      expect(usernameSchema.safeParse(name).success, `${name} should be invalid`).toBe(false)
    }
  })
})

describe('passwordSchema', () => {
  it('accepts valid passwords', () => {
    const valid = ['password1', 'Test1234', 'abcd1234', 'a1b2c3d4']
    for (const pw of valid) {
      expect(passwordSchema.safeParse(pw).success, `${pw} should be valid`).toBe(true)
    }
  })

  it('rejects too short', () => {
    expect(passwordSchema.safeParse('pass1').success).toBe(false)
    expect(passwordSchema.safeParse('abcde1').success).toBe(false)
    expect(passwordSchema.safeParse('abcdef1').success).toBe(false)
  })

  it('rejects no letter', () => {
    expect(passwordSchema.safeParse('12345678').success).toBe(false)
  })

  it('rejects no number', () => {
    expect(passwordSchema.safeParse('abcdefgh').success).toBe(false)
  })
})

describe('emailSchema', () => {
  it('accepts valid emails', () => {
    expect(emailSchema.safeParse('user@example.com').success).toBe(true)
    expect(emailSchema.safeParse('test+tag@gmail.com').success).toBe(true)
  })

  it('rejects invalid emails', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false)
    expect(emailSchema.safeParse('@no-user.com').success).toBe(false)
    expect(emailSchema.safeParse('').success).toBe(false)
  })
})

describe('messageContentSchema', () => {
  it('accepts valid messages', () => {
    expect(messageContentSchema.safeParse('hello').success).toBe(true)
    expect(messageContentSchema.safeParse('a'.repeat(4000)).success).toBe(true)
  })

  it('rejects empty', () => {
    expect(messageContentSchema.safeParse('').success).toBe(false)
  })

  it('rejects too long', () => {
    expect(messageContentSchema.safeParse('a'.repeat(4001)).success).toBe(false)
  })
})

describe('forumUrlSchema', () => {
  it('accepts HTTPS URLs', () => {
    expect(forumUrlSchema.safeParse('https://demo.forumline.net').success).toBe(true)
    expect(forumUrlSchema.safeParse('https://example.com/forum').success).toBe(true)
  })

  it('rejects HTTP URLs', () => {
    expect(forumUrlSchema.safeParse('http://example.com').success).toBe(false)
  })

  it('rejects non-URLs', () => {
    expect(forumUrlSchema.safeParse('not a url').success).toBe(false)
    expect(forumUrlSchema.safeParse('').success).toBe(false)
  })
})
