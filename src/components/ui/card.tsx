import type { ReactNode } from "react";


//



//



export function Card({
  children,
  className,
  ...props
}: {
  children: ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={`border border-line bg-surface ${className ?? ""}`}
      {...props}
    >
      {children}
    </section>
  );
}

/**
 * Section header. A thin vertical mark replaces a section number/label on the
 * left, followed by the title and one action on the right.
 */
export function CardHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-2 border-b border-line px-4 py-3.5 sm:px-5">
      <div className="min-w-0 flex-1">
        <h2 className="text-[length:var(--text-lg)] font-semibold text-ink">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-[length:var(--text-sm)] leading-[var(--leading-normal)] text-muted">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function CardBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`px-4 py-4 sm:px-5 ${className ?? ""}`}>{children}</div>;
}

/**
 * Empty state. A calm text block and, when needed, one guiding action instead of
 * a large illustration or decorative box (§3 — no decorative illustrations).
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-2 px-4 py-9 sm:px-5">
      <span aria-hidden className="h-px w-10 bg-line-strong" />
      <h2 className="text-[length:var(--text-base)] font-medium text-ink">
        {title}
      </h2>
      {description ? (
        <p className="text-[length:var(--text-sm)] leading-[var(--leading-normal)] text-muted">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
