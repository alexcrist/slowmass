// Independent of the application bundle so a failed module load can recover.
(() => {
  if (document.documentElement.dataset.appStarted) return;
  const timer = setTimeout(() => {
    if (document.documentElement.dataset.appStarted) return;
    const status = document.querySelector('[data-startup-status]');
    if (!status) return;
    status.textContent = 'slowmass could not finish starting. Please reload.';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Reload slowmass';
    retry.addEventListener('click', () => location.reload());
    status.after(retry);
  }, 15000);
  window.addEventListener('slowmass:started', () => clearTimeout(timer), {
    once: true,
  });
})();
