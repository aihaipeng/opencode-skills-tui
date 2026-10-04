import { spawn } from "node:child_process"

/** Only http(s) targets are opened; rendered content may carry other schemes. */
export function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/**
 * Resolve the URL a ctrl+click should open, or null. A pending selection
 * means the user was drag-selecting, not clicking a link.
 */
export function resolveLinkToOpen(
  event: { x: number; y: number; modifiers?: { ctrl?: boolean } },
  hasSelection: () => boolean,
  getLinkAt: (x: number, y: number) => string | null,
): string | null {
  if (!event.modifiers?.ctrl || hasSelection()) return null
  const url = getLinkAt(event.x, event.y)
  return url !== null && isHttpUrl(url) ? url : null
}

/** Open the URL in the platform default browser, detached from this process. */
export function openUrl(url: string): void {
  const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open"
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url]
  spawn(command, args, { detached: true, stdio: "ignore" }).unref()
}
