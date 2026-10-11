const palettes = {
  pine: 'Deep Pine',
  fir: 'Douglas Fir',
  cedar: 'Western Redcedar',
  spruce: 'Sitka Spruce',
  hemlock: 'Western Hemlock',
};
const heading = document.querySelector('#selection');
const status = document.querySelector('#copy-status');
function render(palette) {
  document.body.dataset.palette = palette;
  document.querySelector(`input[name="palette"][value="${palette}"]`).checked =
    true;
  heading.textContent = `${palettes[palette]} + Caveat`;
  status.textContent = '';
}
function fromUrl() {
  const params = new URLSearchParams(location.hash.slice(1));
  const palette = Object.hasOwn(palettes, params.get('palette'))
    ? params.get('palette')
    : 'fir';
  render(palette);
}
fromUrl();
window.addEventListener('hashchange', fromUrl);
document.querySelectorAll('input[type="radio"]').forEach((input) => {
  input.addEventListener('change', () => {
    const palette = document.querySelector(
      'input[name="palette"]:checked',
    ).value;
    render(palette);
    history.replaceState(null, '', `#${new URLSearchParams({ palette })}`);
  });
});
document.querySelector('#copy').addEventListener('click', async () => {
  const url = new URL(location.href);
  url.hash = new URLSearchParams({
    palette: document.body.dataset.palette,
  }).toString();
  try {
    await navigator.clipboard.writeText(url.href);
    status.textContent = 'Link copied. Send this link back with your choice.';
  } catch {
    status.textContent = `Copy this link: ${url.href}`;
  }
});

document.querySelectorAll('.preview-jump').forEach((button) => {
  button.addEventListener('click', () =>
    document.querySelector('#preview').scrollIntoView(),
  );
});

document.querySelector('#try-fir').addEventListener('click', () => {
  render('fir');
  history.replaceState(null, '', '#palette=fir');
  document.querySelector('#preview').scrollIntoView();
});
