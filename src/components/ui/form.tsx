import type { ComponentProps, ReactNode } from "react";


//




//
// Mobile input text is fixed at 16px in globals.css so iOS does not zoom on focus.


const CONTROL =
  "w-full rounded-(--radius-sm) border border-line-strong bg-surface px-3 " +
  "text-[length:var(--text-sm)] text-ink placeholder:text-faint " +
  "transition-colors duration-(--duration-fast) " +
  "hover:border-muted " +
  "disabled:cursor-not-allowed disabled:bg-inset disabled:text-muted " +
  "aria-[invalid=true]:border-danger";

const CONTROL_H = "h-(--spacing-control)";

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const controlId = htmlFor;
  const control = children;

  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      {/* The asterisk sits **outside** the label text: it is a visual marker and
          must not become part of the field name. Requiredness is carried by the
          `required` attribute and read by assistive technology. */}
      <span className="flex items-center gap-0.5">
        <label htmlFor={controlId} className="text-[length:var(--text-sm)] font-medium text-ink">
          {label}
        </label>
        {required ? (
          <span aria-hidden className="text-danger">
            *
          </span>
        ) : null}
      </span>
      {control}
      {hint && !error ? (
        <span className="text-[length:var(--text-xs)] text-muted">{hint}</span>
      ) : null}
      {error ? (
        <span role="alert" className="text-[length:var(--text-xs)] font-medium text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input className={`${CONTROL} ${CONTROL_H} ${className ?? ""}`} {...props} />
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={`${CONTROL} resize-y py-2.5 leading-[var(--leading-normal)] ${className ?? ""}`}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select className={`${CONTROL} ${CONTROL_H} ${className ?? ""}`} {...props}>
      {children}
    </select>
  );
}

export function Checkbox({
  label,
  description,
  className,
  ...props
}: ComponentProps<"input"> & { label: ReactNode; description?: ReactNode }) {
  return (
    <label
      className={`flex min-h-(--spacing-touch) cursor-pointer items-start gap-2.5 py-2 text-[length:var(--text-sm)] ${className ?? ""}`}
    >
      <input
        type="checkbox"
        className="mt-0.5 size-4 rounded-(--radius-xs) border-line-strong text-primary"
        {...props}
      />
      <span>
        <span className="font-medium text-ink">{label}</span>
        {description ? (
          <span className="block text-[length:var(--text-xs)] text-muted">{description}</span>
        ) : null}
      </span>
    </label>
  );
}
