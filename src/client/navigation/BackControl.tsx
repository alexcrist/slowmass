export function BackControl({ href, label }: { href: string; label: string }) {
  return (
    <a className="back-control" href={href}>
      <svg
        viewBox="0 0 24 24"
        width={20}
        height={20}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m14 5-7 7 7 7M7 12h14" />
      </svg>
      {label}
    </a>
  );
}
