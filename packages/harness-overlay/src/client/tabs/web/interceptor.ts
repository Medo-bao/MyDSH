import {
  normalizeWebTabUrl,
} from "@minke/harness-overlay/tabs/contract.ts";

function anchorFromClick(
  event: MouseEvent,
): HTMLAnchorElement | undefined {
  for (const candidate of event.composedPath()) {
    if (
      typeof candidate === "object" &&
      candidate !== null &&
      "tagName" in candidate &&
      candidate.tagName === "A"
    ) {
      return candidate as HTMLAnchorElement;
    }
  }
  return undefined;
}

/**
 * Open external HTTP(S) anchors through the desktop's default browser bridge.
 * Local navigation and downloads retain their existing handlers.
 */
export function installExternalWebLinks(
  openExternal: (url: string) => void,
  root: Document = document,
): () => void {
  const view = root.defaultView;
  if (view === null) return () => {};

  const handleClick = (event: MouseEvent): void => {
    if (
      event.defaultPrevented ||
      (event.button !== 0 && event.button !== 1) ||
      event.altKey
    ) {
      return;
    }
    const anchor = anchorFromClick(event);
    if (
      anchor === undefined ||
      anchor.hasAttribute("download")
    ) {
      return;
    }
    const url = normalizeWebTabUrl(anchor.href);
    if (url === undefined) return;
    if (new URL(url).origin === view.location.origin) return;

    event.preventDefault();
    event.stopPropagation();
    openExternal(url);
  };

  root.addEventListener("click", handleClick, true);
  root.addEventListener("auxclick", handleClick, true);
  return () => {
    root.removeEventListener("click", handleClick, true);
    root.removeEventListener("auxclick", handleClick, true);
  };
}
