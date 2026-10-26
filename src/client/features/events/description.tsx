import { Fragment, type ReactNode } from 'react';

// Event descriptions support a small inline Markdown subset: **bold** or
// __bold__, *italic* or _italic_, and ~~strikethrough~~. A backslash escapes a
// marker. Markers pair within one line, a run can't open before or close after
// a space, and underscores inside words (snake_case) stay literal. Anything
// else is plain text; output is React text nodes, never HTML.
export type Inline =
  string | { tag: 'strong' | 'em' | 'del'; children: Inline[] };

const markers = [
  { marker: '**', tag: 'strong' },
  { marker: '__', tag: 'strong' },
  { marker: '~~', tag: 'del' },
  { marker: '*', tag: 'em' },
  { marker: '_', tag: 'em' },
] as const;

const escapable = new Set(['*', '_', '~', '\\']);
const space = (char: string | undefined) =>
  char === undefined || /\s/.test(char);
const word = (char: string | undefined) =>
  char !== undefined && /[\p{L}\p{N}]/u.test(char);

// The end of the matching closer, or -1. Single markers skip doubled runs so
// `*a **b** c*` closes at the last star; a closer extends to the end of its
// run so `***a***` nests.
function closer(text: string, marker: string, start: number) {
  const char = marker.charAt(0);
  for (let at = start; at < text.length; at++) {
    if (text[at] === '\n') return -1;
    if (text[at] === '\\') {
      at++;
      continue;
    }
    if (!text.startsWith(marker, at)) continue;
    if (marker.length === 1 && text[at + 1] === char) {
      while (text[at + 1] === char) at++;
      continue;
    }
    let end = at;
    while (text[end + marker.length] === char) end++;
    if (end > start && !space(text[end - 1])) {
      if (char !== '_' || !word(text[end + marker.length])) return end;
    }
    at = end + marker.length - 1;
  }
  return -1;
}

export function parseDescription(text: string): Inline[] {
  const out: Inline[] = [];
  let plain = '';
  let at = 0;
  while (at < text.length) {
    const char = text.charAt(at);
    if (char === '\\' && escapable.has(text.charAt(at + 1))) {
      plain += text.charAt(at + 1);
      at += 2;
      continue;
    }
    const match = markers.find(({ marker }) => text.startsWith(marker, at));
    if (match) {
      const { marker, tag } = match;
      const start = at + marker.length;
      const opens =
        !space(text[start]) && (char !== '_' || !word(text[at - 1]));
      const end = opens ? closer(text, marker, start) : -1;
      if (end !== -1) {
        if (plain) out.push(plain);
        plain = '';
        out.push({ tag, children: parseDescription(text.slice(start, end)) });
        at = end + marker.length;
        continue;
      }
    }
    // An unmatched marker is text; `**a*` can still open at the second star.
    plain += char;
    at++;
  }
  if (plain) out.push(plain);
  return out;
}

function render(nodes: Inline[]): ReactNode {
  return nodes.map((node, index) => {
    if (typeof node === 'string')
      return <Fragment key={index}>{node}</Fragment>;
    const Tag = node.tag;
    return <Tag key={index}>{render(node.children)}</Tag>;
  });
}

export function EventDescription({ text }: { text: string }) {
  return <p className="event-description">{render(parseDescription(text))}</p>;
}
