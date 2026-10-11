type Props = { label: string } & (
  { href: string; onClick?: never } | { onClick: () => void; href?: never }
);

export function BackControl(props: Props) {
  const content = (
    <>
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
      {props.label}
    </>
  );
  return props.href !== undefined ? (
    <a className="back-control" href={props.href}>
      {content}
    </a>
  ) : (
    <button className="back-control" type="button" onClick={props.onClick}>
      {content}
    </button>
  );
}
