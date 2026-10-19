import { describe, expect, it } from 'vitest';
import { validateEmailInput, validateRegistrationInput } from './authValidation';

describe('customer registration validation', () => {
  it('normalizes a valid registration input', () => {
    expect(validateRegistrationInput({
      email: ' Customer@Example.COM ',
      password: 'correct horse battery staple',
      name: ' Customer One ',
    })).toEqual({
      ok: true,
      value: {
        email: 'customer@example.com',
        password: 'correct horse battery staple',
        displayName: 'Customer One',
      },
    });
  });

  it.each([
    { email: 'not-an-email', password: 'password123', name: 'Customer' },
    { email: 'customer@example.com', password: 'short', name: 'Customer' },
    { email: 'customer@example.com', password: 'password123', name: '' },
    { email: 'customer@example.com', password: 'password123', name: 'x'.repeat(121) },
    { email: 'customer@example.com', password: 'password123', name: 'Customer\nOne' },
    { email: 'customer@example.com', password: 'password123' },
  ])('rejects invalid input', (input) => {
    const result = validateRegistrationInput(input);
    expect(result.ok).toBe(false);
  });

  it('rejects non-object and oversized email input', () => {
    expect(validateRegistrationInput(null).ok).toBe(false);
    expect(validateRegistrationInput({ email: 'a'.repeat(321), password: 'password123', name: 'Customer' }).ok).toBe(false);
  });
});

describe('email-only validation', () => {
  it('accepts a valid email and normalizes it', () => {
    expect(validateEmailInput(' Customer@Example.COM ')).toEqual({
      ok: true,
      value: 'customer@example.com',
    });
  });

  it.each([
    'missing field',
    42,
    null,
    { email: 'customer@example.com' },
    ['customer@example.com'],
    '',
    '   ',
    'not-an-email',
    'user@',
    'user@domain',
    `${'a'.repeat(311)}@example.com`,
  ])('rejects invalid input (%s, type/length)', (input) => {
    expect(validateEmailInput(input).ok).toBe(false);
  });

  it('accepts an email exactly at the 320-character limit', () => {
    const domain = '@example.com';
    const email = 'a'.repeat(320 - domain.length) + domain;
    expect(validateEmailInput(email)).toEqual({ ok: true, value: email });
  });
});
