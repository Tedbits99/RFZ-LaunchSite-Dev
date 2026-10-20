export type RegistrationInput = {
  email: string;
  password: string;
  displayName: string;
};

export type RegistrationValidation =
  | { ok: true; value: RegistrationInput }
  | { ok: false; error: string };

const EMAIL_MAX_LENGTH = 320;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
const DISPLAY_NAME_MAX_LENGTH = 120;

export type EmailValidation =
  | { ok: true; value: string }
  | { ok: false; error: string };

export function validateEmailInput(input: unknown): EmailValidation {
  if (typeof input !== 'string') return { ok: false, error: 'Please provide a valid email address.' };

  const email = input.trim().toLowerCase();
  if (!email || email.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email)) {
    return { ok: false, error: 'Please provide a valid email address.' };
  }
  return { ok: true, value: email };
}

export function validateRegistrationInput(input: unknown): RegistrationValidation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Please provide all required registration fields.' };
  }

  const values = input as Record<string, unknown>;
  const email = typeof values.email === 'string' ? values.email.trim().toLowerCase() : '';
  const password = typeof values.password === 'string' ? values.password : '';
  const displayName = typeof values.name === 'string' ? values.name.trim() : '';

  if (!email || email.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email)) {
    return { ok: false, error: 'Please provide a valid email address.' };
  }
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH || !/\S/.test(password)) {
    return { ok: false, error: `Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.` };
  }
  if (!displayName || displayName.length > DISPLAY_NAME_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(displayName)) {
    return { ok: false, error: 'Please provide a valid display name.' };
  }

  return { ok: true, value: { email, password, displayName } };
}
