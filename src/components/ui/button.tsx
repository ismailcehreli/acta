import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";


//


//



export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-white border-primary hover:bg-primary-hover active:bg-primary-pressed",
  secondary:
    "bg-surface text-ink border-line-strong hover:bg-surface-hover active:bg-inset",
  ghost:
    "bg-transparent text-muted border-transparent hover:bg-surface-hover hover:text-ink",
  danger:
    "bg-surface text-danger border-danger-line hover:bg-danger-soft active:bg-danger-soft",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-2.5 text-[length:var(--text-xs)] gap-1.5",
  md: "h-(--spacing-control) px-4 text-[length:var(--text-sm)] gap-2",
  lg: "h-(--spacing-control-lg) px-5 text-[length:var(--text-base)] gap-2",
};

const TABAN =
  "inline-flex items-center justify-center rounded-(--radius-sm) border font-medium " +
  "transition-colors duration-(--duration-fast) " +
  "disabled:cursor-not-allowed disabled:opacity-45 disabled:pointer-events-none";

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      className={`${TABAN} ${VARIANTS[variant]} ${SIZES[size]} ${className ?? ""}`}
      {...props}
    />
  );
}

export function ButtonLink({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...props
}: ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}) {
  return (
    <Link
      className={`${TABAN} ${VARIANTS[variant]} ${SIZES[size]} ${className ?? ""}`}
      {...props}
    >
      {children}
    </Link>
  );
}
