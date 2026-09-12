import type { ReactNode } from "react";


//


//



//






export type Align = "left" | "right" | "center";

const ALIGN: Record<Align, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

export function Table({
  children,
  label,
}: {
  children: ReactNode;

  label?: string;
}) {
  return (
    <div
      className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      {...(label ? { role: "region", "aria-label": label, tabIndex: 0 } : {})}
    >
      <table className="w-full border-collapse text-[length:var(--text-sm)]">
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="border-b border-line-strong">{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-line">{children}</tbody>;
}

export function TR({
  children,
  className,
  ...props
}: {
  children: ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={`transition-colors duration-(--duration-fast) hover:bg-surface-hover ${className ?? ""}`}
      {...props}
    >
      {children}
    </tr>
  );
}

export function TH({
  children,
  align = "left",
  className,
}: {
  children: ReactNode;
  align?: Align;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`section-label px-3 py-2.5 ${ALIGN[align]} ${className ?? ""}`}
    >
      {children}
    </th>
  );
}

export function TD({
  children,
  align = "left",
  className,
  colSpanAll,
  ...props
}: {
  children: ReactNode;
  align?: Align;
  className?: string;
  /** Cell spanning the whole row, used for inline detail panels. */
  colSpanAll?: boolean;
} & React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      colSpan={colSpanAll ? 99 : props.colSpan}
      className={`px-3 py-3 align-top text-ink ${ALIGN[align]} ${className ?? ""}`}
      {...props}
    >
      {children}
    </td>
  );
}

/**
 * Record list — the narrow-screen equivalent of a table.
 *
 * Each record consists of fields with visible labels. The layout changes instead
 * of shrinking the table because a six-column table at 390px is either unreadable
 * or requires horizontal scrolling, both of which fail for field users on phones.
 */
export function RecordList({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-line">{children}</ul>;
}

export function RecordItem({
  children,
  className,
  ...props
}: {
  children: ReactNode;
  className?: string;
} & React.LiHTMLAttributes<HTMLLIElement>) {
  return (
    <li className={`px-4 py-3.5 ${className ?? ""}`} {...props}>
      {children}
    </li>
  );
}

/** One record field: a small label above its value. */
export function RecordField({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-0.5 ${className ?? ""}`}>
      <span className="section-label">{label}</span>
      <span className="text-[length:var(--text-sm)] text-ink">{children}</span>
    </div>
  );
}
