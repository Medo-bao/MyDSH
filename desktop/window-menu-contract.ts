export const WINDOW_MENU_POPUP_CHANNEL = "firefly:window-menu-popup";

export const WINDOW_MENU_KINDS = ["file", "edit", "view", "help"] as const;
export type WindowMenuKind = (typeof WINDOW_MENU_KINDS)[number];

export type WindowMenuPopupRequest = Readonly<{
  kind: WindowMenuKind;
  x: number;
  y: number;
}>;

export function parseWindowMenuPopupRequest(
  value: unknown,
): WindowMenuPopupRequest {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("invalid window menu popup request");
  }
  const kind = Reflect.get(value, "kind");
  const x = Reflect.get(value, "x");
  const y = Reflect.get(value, "y");
  if (
    !WINDOW_MENU_KINDS.includes(kind as WindowMenuKind) ||
    !Number.isSafeInteger(x) ||
    !Number.isSafeInteger(y) ||
    (x as number) < 0 ||
    (y as number) < 0 ||
    (x as number) > 100_000 ||
    (y as number) > 100_000
  ) {
    throw new TypeError("invalid window menu popup request");
  }
  return { kind: kind as WindowMenuKind, x: x as number, y: y as number };
}
