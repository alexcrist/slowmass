// Content is reauthorized on return. Keep the saved offset while asynchronous
// lists and images rebuild the page, without fighting any new user input.
export function restoreScroll(top: number) {
  const move = () => window.scrollTo({ top, behavior: 'instant' });
  move();
  if (top <= 0) return () => {};
  const observer = new ResizeObserver(move);
  observer.observe(document.body);
  const stop = () => {
    observer.disconnect();
    clearTimeout(timeout);
    window.removeEventListener('wheel', stop);
    window.removeEventListener('touchstart', stop);
    window.removeEventListener('pointerdown', stop);
    window.removeEventListener('keydown', stop);
  };
  // API reads have a 15-second deadline. Never leave a restoration running
  // indefinitely if content was deleted or a request failed.
  const timeout = setTimeout(stop, 20_000);
  window.addEventListener('wheel', stop, { passive: true });
  window.addEventListener('touchstart', stop, { passive: true });
  window.addEventListener('pointerdown', stop);
  window.addEventListener('keydown', stop);
  return stop;
}
