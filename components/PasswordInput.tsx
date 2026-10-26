'use client';

import { Eye, EyeOff, Lock } from 'lucide-react';
import { useId, useState, type InputHTMLAttributes } from 'react';

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: string };

/** Password field with keyboard-accessible visibility control. */
export default function PasswordInput({ label, id, className = '', ...props }: PasswordInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [visible, setVisible] = useState(false);

  return (
    <label className="block space-y-1.5" htmlFor={inputId}>
      <span className="block text-xs font-semibold text-[var(--rfz-muted)]">{label}</span>
      <span className="flex min-h-11 items-center gap-2 rounded-[.6rem] border border-[var(--rfz-line-strong)] bg-[var(--rfz-surface-raised)] px-3 transition focus-within:border-[var(--rfz-accent)] focus-within:ring-2 focus-within:ring-[var(--rfz-accent-soft)]">
        <Lock size={15} aria-hidden="true" className="shrink-0 text-[var(--rfz-subtle)]" />
        <input {...props} id={inputId} type={visible ? 'text' : 'password'} className={`min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--rfz-subtle)] ${className}`} />
        <button type="button" className="grid size-8 shrink-0 place-items-center rounded-md text-[var(--rfz-muted)] hover:text-[var(--rfz-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rfz-accent)]" aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible} onClick={() => setVisible((current) => !current)}>
          {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        </button>
      </span>
    </label>
  );
}
