import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

/**
 * Primitives d'interface partagees. Elles existent pour que les ecrans restent
 * coherents (memes hauteurs tactiles, memes contrastes) sans dependre d'une
 * bibliotheque de composants externe.
 */

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const buttonStyles: Record<ButtonVariant, string> = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 focus-visible:outline-brand-700',
  secondary:
    'bg-white text-ink-800 ring-1 ring-inset ring-ink-300 hover:bg-ink-50 focus-visible:outline-ink-500',
  ghost: 'text-ink-700 hover:bg-ink-100 focus-visible:outline-ink-500',
  danger: 'bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-600',
};

// min-h-11 = 44 px : la cible tactile minimale recommandee, indispensable pour
// une saisie de vente faite au doigt sur un telephone.
const buttonBase =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60';

export function Button({
  variant = 'primary',
  className,
  ...props
}: ComponentProps<'button'> & { variant?: ButtonVariant }) {
  return <button className={cx(buttonBase, buttonStyles[variant], className)} {...props} />;
}

export function ButtonLink({
  variant = 'primary',
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant }) {
  return <Link className={cx(buttonBase, buttonStyles[variant], className)} {...props} />;
}

export function Card({
  title,
  description,
  action,
  className,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cx('rounded-xl bg-white shadow-sm ring-1 ring-ink-200', className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-200 px-4 py-3 sm:px-5">
          <div>
            {title && <h2 className="text-base font-semibold text-ink-900">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-ink-500">{description}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink-700">
        {label}
        {required && <span className="ml-1 text-red-600" aria-hidden="true">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-ink-500">{hint}</p>}
      {error && (
        <p className="text-xs font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const controlBase =
  'block w-full min-h-11 rounded-lg border-0 bg-white px-3 py-2 text-ink-900 ring-1 ring-inset ring-ink-300 placeholder:text-ink-400 focus:ring-2 focus:ring-inset focus:ring-brand-600';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cx(controlBase, className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cx(controlBase, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cx(controlBase, 'min-h-24', className)} {...props} />;
}

export function Alert({
  tone = 'error',
  title,
  children,
}: {
  tone?: 'error' | 'success' | 'info' | 'warning';
  title?: string;
  children: ReactNode;
}) {
  const tones = {
    error: 'bg-red-50 text-red-800 ring-red-200',
    success: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
    info: 'bg-sky-50 text-sky-800 ring-sky-200',
    warning: 'bg-amber-50 text-amber-900 ring-amber-200',
  } as const;

  return (
    <div className={cx('rounded-lg px-4 py-3 text-sm ring-1 ring-inset', tones[tone])} role="alert">
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? 'mt-1' : undefined}>{children}</div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-ink-300 px-6 py-12 text-center">
      <p className="font-medium text-ink-800">{title}</p>
      {description && <p className="max-w-md text-sm text-ink-500">{description}</p>}
      {action}
    </div>
  );
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  children: ReactNode;
}) {
  const tones = {
    neutral: 'bg-ink-100 text-ink-700 ring-ink-200',
    success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    warning: 'bg-amber-50 text-amber-800 ring-amber-200',
    danger: 'bg-red-50 text-red-700 ring-red-200',
    info: 'bg-sky-50 text-sky-700 ring-sky-200',
  } as const;

  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}
