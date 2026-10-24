// Blank lines separate caption paragraphs; single line breaks stay inside one.
export function captionParagraphs(caption: string) {
  return caption
    .split(/\n[^\S\n]*\n\s*/)
    .map((paragraph) => paragraph.replace(/^\s+|\s+$/g, ''))
    .filter(Boolean);
}
