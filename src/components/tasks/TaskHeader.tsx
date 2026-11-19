import type { ReactNode } from "react";

/** A task tab's head: what it is, one line about it, and its one action when it has one. */
export function TaskHeader({ icon, title, isMono = false, detail, action }: { icon: ReactNode; title: string; isMono?: boolean; detail: string; action?: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-2.5 px-3.5 pt-3.5 pb-3">
      <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-hover text-fg-secondary">
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <h2 title={title} className={`truncate text-fg ${isMono ? "font-mono text-ui-sm font-medium" : "text-ui font-semibold"}`}>
          {title}
        </h2>
        <span className="truncate text-caption text-fg-subtle">{detail}</span>
      </div>
      {action}
    </div>
  );
}

/** A quiet note with what the user should know about where this content comes from. */
export function TaskNote({ children }: { children: ReactNode }) {
  return <p className="text-caption text-fg-subtle">{children}</p>;
}
