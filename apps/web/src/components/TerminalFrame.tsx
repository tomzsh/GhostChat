import type { ReactNode } from "react";

type Props = {
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Full-viewport shell (room chat). Default is compact centered card. */
  variant?: "card" | "app";
  headerRight?: ReactNode;
  /** Hide footer on small screens (room uses status elsewhere). */
  hideFooterOnMobile?: boolean;
};

/**
 * Mobile-first terminal chrome.
 * - card: landing / error (scrollable page)
 * - app: room (fixed viewport height — keyboard-friendly flex column)
 */
export function TerminalFrame({
  title,
  children,
  footer,
  variant = "card",
  headerRight,
  hideFooterOnMobile = false,
}: Props) {
  const isApp = variant === "app";

  return (
    <div
      className={
        isApp
          ? "terminal-grid app-shell flex flex-col bg-ghost-bg"
          : "terminal-grid flex min-h-dvh flex-col items-stretch justify-start p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:items-center sm:justify-center sm:p-6"
      }
    >
      <div
        className={
          isApp
            ? "flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden border-0 bg-ghost-panel sm:mx-auto sm:max-w-2xl sm:border sm:border-ghost-border sm:shadow-[0_0_40px_rgba(51,255,102,0.06)]"
            : "flex w-full max-w-2xl flex-col border border-ghost-border bg-ghost-panel/95 shadow-[0_0_40px_rgba(51,255,102,0.06)]"
        }
      >
        <header className="safe-top flex shrink-0 items-center gap-1.5 border-b border-ghost-border px-2.5 py-2 sm:gap-2 sm:px-4 sm:py-3">
          <span
            className="hidden size-2 shrink-0 rounded-full bg-ghost-red/80 xs:block sm:size-2.5"
            aria-hidden
          />
          <span
            className="hidden size-2 shrink-0 rounded-full bg-ghost-amber/80 sm:block sm:size-2.5"
            aria-hidden
          />
          <span
            className="size-1.5 shrink-0 rounded-full bg-ghost-green/80 sm:size-2.5"
            aria-hidden
          />
          <span className="ml-1.5 min-w-0 flex-1 truncate text-[10px] uppercase tracking-wider text-ghost-dim sm:ml-2 sm:text-xs sm:tracking-widest">
            {title ?? "ghostchat"}
          </span>
          {headerRight ? (
            <div className="ml-1 flex shrink-0 items-center gap-1.5 sm:ml-2 sm:gap-2">
              {headerRight}
            </div>
          ) : null}
        </header>

        <div
          className={
            isApp
              ? "flex min-h-0 flex-1 flex-col overflow-hidden"
              : "p-4 sm:p-6 md:p-8"
          }
        >
          {children}
        </div>

        {footer ? (
          <footer
            className={`shrink-0 border-t border-ghost-border px-2.5 py-1.5 text-[10px] text-ghost-dim sm:px-4 sm:py-2.5 sm:text-xs ${
              hideFooterOnMobile ? "hidden sm:block" : ""
            } ${isApp ? "safe-x" : "safe-bottom"}`}
          >
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
