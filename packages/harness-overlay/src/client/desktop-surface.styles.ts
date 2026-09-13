import {
  defineOverlayStyle,
} from "./style-runtime.ts";
import DESKTOP_SURFACE_STYLES from "./desktop-surface.css";

export { DESKTOP_SURFACE_STYLES };

/** Install the Windows desktop-surface stylesheet. */
export const installDesktopSurfaceStyles = defineOverlayStyle(
  "desktop-surface",
  DESKTOP_SURFACE_STYLES,
);
