import { Suspense, type ReactNode } from "react";

interface LazyBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  fallbackClassName?: string;
  fallbackLabel?: string;
  testId?: string;
}

const DEFAULT_FALLBACK_CLASS_NAME =
  "flex min-h-0 flex-1 items-center justify-center bg-background-dark text-sm text-slate-500";

export function LazyBoundary({
  children,
  fallback,
  fallbackClassName = DEFAULT_FALLBACK_CLASS_NAME,
  fallbackLabel = "Loading…",
  testId,
}: LazyBoundaryProps) {
  return (
    <Suspense
      fallback={
        fallback ?? (
          <div className={fallbackClassName} data-testid={testId}>
            {fallbackLabel}
          </div>
        )
      }
    >
      {children}
    </Suspense>
  );
}
