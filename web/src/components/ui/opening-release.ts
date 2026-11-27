import * as React from "react"

/**
 * Handlers for a menu's content so the release of the right-click (or Ctrl+click) that opened it never picks an
 * item. On macOS a context menu opens while the button is still down, and its slide-in (or a shift to fit the
 * window) can put an item under the pointer; on Windows it opens after the release, so nothing changes there.
 * A release that is ignored doesn't reach the caller's onPointerUpCapture either.
 */
export function useOpeningReleaseGuard<E extends Element>(
  onPointerDownCapture?: React.PointerEventHandler<E>,
  onPointerUpCapture?: React.PointerEventHandler<E>
) {
  // whether the press being released began inside this menu
  const pressedInside = React.useRef(false)
  return {
    onPointerDownCapture: (e: React.PointerEvent<E>) => {
      pressedInside.current = true
      // forgotten once that press ends, wherever it ends (after this menu has seen the release, if it's here)
      const done = new AbortController()
      const forget = () => {
        pressedInside.current = false
        done.abort()
      }
      window.addEventListener("pointerup", forget, { signal: done.signal })
      window.addEventListener("pointercancel", forget, { signal: done.signal })
      onPointerDownCapture?.(e)
    },
    onPointerUpCapture: (e: React.PointerEvent<E>) => {
      if (!pressedInside.current && (e.button === 2 || e.ctrlKey)) {
        e.stopPropagation()
        return
      }
      onPointerUpCapture?.(e)
    },
  }
}
