// Keep the opener visible even when the loaded thread exceeds the viewport.
export function revealCommentComposer(button: Element, composer: Element) {
  const padding = 16;
  const viewport = window.visualViewport;
  const top = viewport?.offsetTop ?? 0;
  let bottom = top + (viewport?.height ?? window.innerHeight);
  const field = composer.getBoundingClientRect();
  const navigation = document
    .querySelector('.app-navigation')
    ?.getBoundingClientRect();
  // The mobile bar includes its safe-area padding. The desktop sidebar does
  // not obscure the composer and must not reduce the available height.
  if (
    navigation &&
    navigation.left < field.right &&
    navigation.right > field.left &&
    navigation.top > top &&
    navigation.top < bottom &&
    navigation.bottom >= bottom
  )
    bottom = navigation.top;
  const distance = Math.min(
    field.bottom + padding - bottom,
    button.getBoundingClientRect().top - top - padding,
  );
  if (distance <= 0) return;
  const start = window.scrollY;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    window.scrollTo({ top: start + distance, behavior: 'instant' });
    return;
  }
  const started = performance.now();
  let frame: number;
  const cancel = () => {
    cancelAnimationFrame(frame);
    window.removeEventListener('wheel', cancel);
    window.removeEventListener('touchstart', cancel);
    window.removeEventListener('keydown', cancel);
  };
  const step = (now: number) => {
    const progress = Math.min(1, (now - started) / 180);
    const eased = 1 - (1 - progress) ** 3;
    window.scrollTo({ top: start + distance * eased, behavior: 'instant' });
    if (progress < 1) frame = requestAnimationFrame(step);
    else cancel();
  };
  window.addEventListener('wheel', cancel, { passive: true });
  window.addEventListener('touchstart', cancel, { passive: true });
  window.addEventListener('keydown', cancel);
  frame = requestAnimationFrame(step);
  return cancel;
}
