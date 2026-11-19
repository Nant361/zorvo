import { LoaderCircle, X } from "lucide-react";

export interface TaskTabItem {
  key: string;
  name: string;
  isRunning: boolean;
  /** A command shows in mono, as it does everywhere else. */
  isMono: boolean;
}

export interface TaskTabStripProps {
  items: readonly TaskTabItem[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
}

/** The open tasks as tabs under the inspector's own, like the Terminal tab's shells: a name and a way to close it. */
export function TaskTabStrip({ items, selectedKey, onSelect, onClose }: TaskTabStripProps) {
  return (
    <div role="tablist" aria-label="Open tasks" className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-border pr-2 pl-2.5">
      {items.map((item) => {
        const isSelected = item.key === selectedKey;
        return (
          <div
            key={item.key}
            className={`flex h-6 shrink-0 items-center rounded-md text-ui-sm ${isSelected ? "bg-surface-hover text-fg" : "text-fg-muted"}`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={isSelected}
              title={item.name}
              onClick={() => onSelect(item.key)}
              className={`focus-ring flex h-6 max-w-48 items-center gap-1.5 rounded-md pr-0.5 pl-2 ${item.isMono ? "font-mono" : ""}`}
            >
              {item.isRunning && (
                <>
                  <LoaderCircle size={12} strokeWidth={2.25} aria-hidden="true" className="shrink-0 text-status-running motion-safe:animate-spin" />
                  <span className="sr-only">Running</span>
                </>
              )}
              <span className="truncate">{item.name}</span>
            </button>
            <button
              type="button"
              aria-label={`Close ${item.name}`}
              onClick={() => onClose(item.key)}
              className="focus-ring mr-0.5 flex size-5 shrink-0 items-center justify-center rounded-sm text-fg-muted hover:bg-chip hover:text-fg"
            >
              <X size={12} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
