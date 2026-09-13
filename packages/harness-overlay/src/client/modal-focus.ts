const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex], [contenteditable="true"]';

/** Keep keyboard navigation inside the active modal without changing upstream markup. */
export function installModalFocus(root: Document): () => void {
  let modal: HTMLElement | undefined;
  let restore: HTMLElement | undefined;
  let lastOutside = root.activeElement as HTMLElement | null;
  const visible = (element: HTMLElement) => element.getClientRects().length > 0 && !element.closest('[inert], [aria-hidden="true"]') && root.defaultView!.getComputedStyle(element).visibility !== "hidden";
  const targets = () => modal ? [...modal.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(element => element.tabIndex >= 0 && visible(element)) : [];
  const focusFirst = () => { targets()[0]?.focus({ preventScroll: true }); };
  const reconcile = () => {
    const next = [...root.querySelectorAll<HTMLElement>('[aria-modal="true"][role="dialog"], [aria-modal="true"][role="alertdialog"], dialog[open]')].filter(visible).at(-1);
    if (next === modal) return;
    if (next) {
      if (!modal) restore = lastOutside ?? undefined;
      modal = next;
      if (!modal.contains(root.activeElement)) focusFirst();
    } else {
      modal = undefined;
      if (restore?.isConnected && visible(restore)) restore.focus({ preventScroll: true });
      restore = undefined;
    }
  };
  const onFocus = (event: FocusEvent) => {
    const element = event.target as HTMLElement;
    reconcile();
    if (!modal) { lastOutside = element; return; }
    if (!modal.contains(element) && !element.closest('[role="menu"], [role="listbox"], [popover]')) focusFirst();
  };
  const onKey = (event: KeyboardEvent) => {
    reconcile();
    if (!modal || event.key !== "Tab") return;
    const items = targets();
    const index = items.indexOf(root.activeElement as HTMLElement);
    if (items.length === 0) { event.preventDefault(); return; }
    if (index < 0 || (!event.shiftKey && index === items.length - 1) || (event.shiftKey && index === 0)) {
      event.preventDefault();
      items[event.shiftKey ? items.length - 1 : 0].focus();
    }
  };
  const observer = new MutationObserver(reconcile);
  observer.observe(root.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-modal", "hidden", "open"] });
  root.addEventListener("focusin", onFocus, true);
  root.addEventListener("keydown", onKey, true);
  reconcile();
  return () => {
    observer.disconnect();
    root.removeEventListener("focusin", onFocus, true);
    root.removeEventListener("keydown", onKey, true);
  };
}
