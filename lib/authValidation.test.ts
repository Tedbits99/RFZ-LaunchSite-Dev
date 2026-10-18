import { describe, expect, it } from 'vitest';
import { validateRegistrationInput } from './authValidation';

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
