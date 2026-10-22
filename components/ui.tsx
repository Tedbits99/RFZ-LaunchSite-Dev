import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

type Tone = 'primary' | 'secondary' | 'quiet' | 'danger';

const buttonTones: Record<Tone, string> = {
  primary: 'bg-gradient-to-r from-cyan-400 to-blue-500 text-slate-950 shadow-lg shadow-cyan-950/30 hover:brightness-110',
  secondary: 'border border-[#294264] bg-[#111c33] text-slate-100 hover:border-cyan-300/60 hover:bg-[#162642]',
  quiet: 'text-slate-300 hover:bg-white/5 hover:text-white',
  danger: 'border border-rose-400/30 bg-rose-400/10 text-rose-200 hover:bg-rose-400/20',
};

export function Button({ tone = 'primary', className = '', children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone }) {
  return <button {...props} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-[.65rem] px-4 text-sm font-semibold transition duration-200 ${buttonTones[tone]} ${className}`}>{children}</button>;
}

export function TextInput({ label, hint, error, className = '', id, ...props }: InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string; error?: string }) {
  const inputId = id ?? props.name;
  return <label className="block space-y-1.5" htmlFor={inputId}><span className="block text-xs font-semibold text-slate-300">{label}</span><input {...props} id={inputId} className={`rfz-input w-full px-3 text-sm placeholder:text-slate-600 ${error ? 'border-rose-400/70' : ''} ${className}`} />{error ? <span className="block text-xs text-rose-300" role="alert">{error}</span> : hint ? <span className="block text-xs text-slate-500">{hint}</span> : null}</label>;
}

export function Panel({ title, description, actions, children, className = '' }: { title?: string; description?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`surface p-5 sm:p-6 ${className}`}>{title || actions ? <header className="mb-5 flex flex-col justify-between gap-3 border-b border-[#1b2b48] pb-4 sm:flex-row sm:items-start"><div>{title && <h2 className="font-display text-lg font-semibold text-white">{title}</h2>}{description && <p className="mt-1 text-sm text-slate-400">{description}</p>}</div>{actions}</header> : null}{children}</section>;
}

export function Skeleton({ className = '' }: { className?: string }) { return <span aria-hidden="true" className={`block animate-pulse rounded-md bg-white/10 ${className}`} />; }
