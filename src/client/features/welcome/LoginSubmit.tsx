// Both email entry and the installed-app link helper share a compact submit
// control. The action remains named for keyboard and assistive-technology use.
export function LoginSubmit({
  label,
  busy = false,
}: {
  label: string;
  busy?: boolean;
}) {
  return (
    <button
      type="submit"
      className="login-submit"
      disabled={busy}
      aria-label={label}
      title={label}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m21 3-6.5 18-4-7.5L3 9.5 21 3Z" />
        <path d="m10.5 13.5 5-5" />
      </svg>
    </button>
  );
}
