export const WINDOW_CONTROL_CHANNEL = "mydsh:window:control";
export const WINDOW_STATE_CHANNEL = "mydsh:window:state";
export const CLOSE_BEHAVIOR_CHANNEL = "mydsh:settings:close-behavior";
export type CloseBehavior = "tray" | "quit";
export function parseCloseBehavior(value: unknown): CloseBehavior {
  if (value !== "tray" && value !== "quit") throw new TypeError("Invalid close behavior");
  return value;
}
export type WindowAction = "minimize" | "maximize" | "close" | "state";
export interface WindowState { maximized: boolean; visible: boolean }
