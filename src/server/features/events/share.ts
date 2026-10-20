// Only a title and the current link belong in unfurl metadata. HTMLRewriter
// handles the document title as text; attribute values must be escaped here.
function attribute(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function eventShareHtml(shell: Response, title: string, url: string) {
  const image = `${url}/photo`;
  const metadata = [
    ['property', 'og:type', 'website'],
    ['property', 'og:site_name', 'slowmass'],
    ['property', 'og:title', title],
    ['property', 'og:url', url],
    ['property', 'og:image', image],
    ['property', 'og:image:type', 'image/webp'],
    ['property', 'og:image:alt', `Cover photo for ${title}`],
    ['name', 'twitter:card', 'summary_large_image'],
    ['name', 'twitter:title', title],
    ['name', 'twitter:image', image],
    ['name', 'twitter:image:alt', `Cover photo for ${title}`],
    ['name', 'robots', 'noindex, nofollow'],
    ['name', 'referrer', 'no-referrer'],
  ]
    .map(
      ([kind, name, content]) =>
        `<meta ${kind}="${name}" content="${attribute(content)}">`,
    )
    .join('');
  // Do not inherit the asset shell's caching policy, ETag or content length.
  return new HTMLRewriter()
    .on('title', {
      element(element) {
        element.setInnerContent(title);
      },
    })
    .on('meta[name="description"]', {
      element(element) {
        element.remove();
      },
    })
    .on('head', {
      element(element) {
        element.append(metadata, { html: true });
      },
    })
    .transform(
      new Response(shell.body, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }),
    );
}
