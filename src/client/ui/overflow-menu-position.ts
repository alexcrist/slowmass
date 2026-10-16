type Rectangle = { left: number; right: number; top: number; bottom: number };

// All coordinates are viewport-relative; the caller converts to its container.
export function overflowMenuPosition(
  anchor: Rectangle,
  menu: { width: number; height: number },
  bounds: Rectangle,
) {
  const gap = 4;
  const availableHeight = Math.max(0, bounds.bottom - bounds.top);
  const below = Math.min(
    availableHeight,
    Math.max(0, bounds.bottom - anchor.bottom - gap),
  );
  const above = Math.min(
    availableHeight,
    Math.max(0, anchor.top - gap - bounds.top),
  );
  const upward = menu.height > below && above > below;
  const maxHeight = upward ? above : below;
  const height = Math.min(menu.height, maxHeight);
  const width = Math.min(menu.width, bounds.right - bounds.left);
  return {
    left: Math.max(
      bounds.left,
      Math.min(anchor.right - width, bounds.right - width),
    ),
    top: Math.max(
      bounds.top,
      Math.min(
        upward ? anchor.top - gap - height : anchor.bottom + gap,
        bounds.bottom - height,
      ),
    ),
    maxHeight,
  };
}
