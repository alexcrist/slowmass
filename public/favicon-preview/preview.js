const names = {
  monogram: 'Original sm',
  'sm-large': 'Larger lettering',
  'sm-airy': 'More breathing room',
  'sm-spaced': 'Open spacing',
  'sm-square': 'Square corners',
  'sm-circle': 'Round stamp',
  'sm-cream': 'Cream tile',
  'sm-border': 'Inset border',
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
  select(Object.hasOwn(names, id) ? id : 'monogram');
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
