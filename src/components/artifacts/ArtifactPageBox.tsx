import { useRef } from "react";
import { useArtifactView, useBoxCovered, type ArtifactViewTarget } from "../../hooks/useArtifactView";

export interface ArtifactPageBoxProps {
  /** The page to show. */
  target: ArtifactViewTarget;
  /** The artifact's title, which names the box. */
  title: string;
  /** One of the viewer's own menus or panels is open over the box. */
  isCovered: boolean;
  onError: (message: string) => void;
}

/**
 * The empty box where an artifact's page shows. The page itself is a webview of
 * its own that the backend places over this box; nothing of the page is in
 * Zorvo's document, so there is no frame here.
 */
export function ArtifactPageBox({ target, title, isCovered, onError }: ArtifactPageBoxProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const isOverlaid = useBoxCovered(boxRef, true);
  useArtifactView(boxRef, target, isCovered || isOverlaid, onError);
  return <div ref={boxRef} role="img" aria-label={title} data-artifact-box="" className="min-h-0 flex-1 bg-surface-2" />;
}
