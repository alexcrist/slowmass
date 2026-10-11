const palettes = {
  forest: 'Forest',
  pine: 'Deep pine',
  moss: 'Moss',
  fern: 'Fern',
  slate: 'Original slate',
};
const fonts = {
  fraunces: 'Fraunces',
  dmsans: 'DM Sans',
  sora: 'Sora',
  grandhotel: 'Grand Hotel',
  caveat: 'Caveat',
  lobster: 'Lobster Two',
};
const heading = document.querySelector('#selection');
const status = document.querySelector('#copy-status');
function render(palette, font) {
  document.body.dataset.palette = palette;
  document.body.dataset.font = font;
  document.querySelector(`input[name="palette"][value="${palette}"]`).checked =
    true;
  document.querySelector(`input[name="font"][value="${font}"]`).checked = true;
  heading.textContent = `${palettes[palette]} + ${fonts[font]}`;
  status.textContent = '';
}
function fromUrl() {
  const params = new URLSearchParams(location.hash.slice(1));
  const palette = Object.hasOwn(palettes, params.get('palette'))
    ? params.get('palette')
    : 'forest';
  const font = Object.hasOwn(fonts, params.get('font'))
    ? params.get('font')
    : 'fraunces';
  render(palette, font);
}
fromUrl();
window.addEventListener('hashchange', fromUrl);
document.querySelectorAll('input[type="radio"]').forEach((input) => {
  input.addEventListener('change', () => {
    const palette = document.querySelector(
      'input[name="palette"]:checked',
    ).value;
    const font = document.querySelector('input[name="font"]:checked').value;
    render(palette, font);
    history.replaceState(
      null,
      '',
      `#${new URLSearchParams({ palette, font })}`,
    );
  });
});
document.querySelector('#copy').addEventListener('click', async () => {
  const url = new URL(location.href);
  url.hash = new URLSearchParams({
    palette: document.body.dataset.palette,
    font: document.body.dataset.font,
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
