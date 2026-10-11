const names = {
  script: 'Caveat s',
  cream: 'Cream tile',
  circle: 'Round stamp',
  monogram: 'sm monogram',
  fir: 'Douglas fir',
  frame: 'Photo frame',
};
function select(id) {
  document.querySelector(`input[value="${id}"]`).checked = true;
  const path = `/favicon-preview/icons/${id}.svg`;
  document.querySelector('#preview-icon').href = path;
  document.querySelector('#download').href = path;
  document.querySelector('#download').download = `slowmass-${id}.svg`;
  document.querySelector('#selection').textContent = `Selected: ${names[id]}`;
  document.querySelector('#status').textContent = '';
}
function fromUrl() {
  const id = new URLSearchParams(location.hash.slice(1)).get('icon');
  select(Object.hasOwn(names, id) ? id : 'script');
}
fromUrl();
window.addEventListener('hashchange', fromUrl);
document.querySelectorAll('input[name="icon"]').forEach((input) =>
  input.addEventListener('change', () => {
    select(input.value);
    history.replaceState(null, '', `#icon=${input.value}`);
  }),
);
document.querySelector('#copy').addEventListener('click', async () => {
  const url = new URL(location.href);
  url.hash = `icon=${document.querySelector('input[name="icon"]:checked').value}`;
  try {
    await navigator.clipboard.writeText(url.href);
    document.querySelector('#status').textContent =
      'Link copied. Send it back with your choice.';
  } catch {
    document.querySelector('#status').textContent =
      `Copy this link: ${url.href}`;
  }
});
