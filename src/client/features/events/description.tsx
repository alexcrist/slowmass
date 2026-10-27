import { Fragment, type ReactNode } from 'react';

// Event descriptions support a small inline Markdown subset: **bold** or
// __bold__, *italic* or _italic_, and ~strikethrough~ or ~~strikethrough~~,
// following GitHub's rules. A backslash escapes a marker. Markers pair within
// one line, a run can't open before or close after a space, underscores inside
// words (snake_case) stay literal, and a tilde run closes only on a run of the
// same length (three or more tildes never strike). Anything else is plain
// text; output is React text nodes, never HTML.
export type Inline =
  string | { tag: 'strong' | 'em' | 'del'; children: Inline[] };

const markers = [
  { marker: '**', tag: 'strong' },
  { marker: '__', tag: 'strong' },
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

const run = (text: string, at: number) => {
  let end = at;
  while (text[end] === text[at]) end++;
  return end - at;
};

// The start of a tilde run exactly `length` long that closes, or -1.
function tildeCloser(text: string, length: number, start: number) {
  for (let at = start; at < text.length; at++) {
    if (text[at] === '\n') return -1;
    if (text[at] === '\\') {
      at++;
      continue;
    }
    if (text[at] !== '~') continue;
    const found = run(text, at);
    if (found === length && at > start && !space(text[at - 1])) return at;
    at += found - 1;
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
    if (char === '~') {
      const length = run(text, at);
      const start = at + length;
      const end =
        length <= 2 && !space(text[start])
          ? tildeCloser(text, length, start)
          : -1;
      if (end !== -1) {
        if (plain) out.push(plain);
        plain = '';
        out.push({
          tag: 'del',
          children: parseDescription(text.slice(start, end)),
        });
        at = end + length;
      } else {
        plain += text.slice(at, start);
        at = start;
      }
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
