import type { ReactNode } from "react";
import FIREFLY_ICON_URL from "@minke/resources/icons/icon.png";

export interface FireflyBrandMarkProps {
  className?: string;
  size: number;
}

/** Firefly desktop artwork shared by the sidebar rail and empty-session hero. */
export function FireflyBrandMark({
  className,
  size,
}: FireflyBrandMarkProps): ReactNode {
  return (
    <img
      data-firefly-brand-mark
      className={className}
      src={FIREFLY_ICON_URL}
      alt=""
      aria-hidden="true"
      style={{ width: size, height: size }}
    />
  );
}
