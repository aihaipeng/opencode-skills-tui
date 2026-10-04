import { expect, test } from "bun:test"
import { isHttpUrl, resolveLinkToOpen } from "../src/open-link"

test("isHttpUrl accepts only http and https", () => {
  expect(isHttpUrl("https://example.com")).toBe(true)
  expect(isHttpUrl("http://example.com")).toBe(true)
  expect(isHttpUrl("file:///etc/passwd")).toBe(false)
  expect(isHttpUrl("javascript:alert(1)")).toBe(false)
  expect(isHttpUrl("example.com")).toBe(false)
})

test("resolveLinkToOpen requires ctrl, no selection, and an http link at the click", () => {
  const getLinkAt = (x: number, y: number) => (x === 3 && y === 2 ? "https://example.com/docs" : null)
  const click = { x: 3, y: 2, modifiers: { ctrl: true } }
  const noCtrl = { x: 3, y: 2, modifiers: { ctrl: false } }

  expect(resolveLinkToOpen(click, () => false, getLinkAt)).toBe("https://example.com/docs")
  expect(resolveLinkToOpen(noCtrl, () => false, getLinkAt)).toBe(null)
  // Drag-selection ending on the link must not open it.
  expect(resolveLinkToOpen(click, () => true, getLinkAt)).toBe(null)
  // Click on a non-link cell.
  expect(resolveLinkToOpen({ ...click, x: 1 }, () => false, getLinkAt)).toBe(null)
  // Rendered non-http schemes are never opened by the plugin.
  expect(resolveLinkToOpen(click, () => false, () => "file:///etc/passwd")).toBe(null)
})
