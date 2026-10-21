export function GoogleSignIn({
  busy,
  disabled,
  onClick,
}: {
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="google-sign-in">
      <div className="sign-in-divider" aria-hidden="true">
        <span>or</span>
      </div>
      <button
        type="button"
        aria-label="Continue with Google"
        className="google-sign-in-button"
        disabled={disabled}
        onClick={onClick}
        aria-busy={busy}
      >
        <img src="/identity/google-g.png" alt="" width="20" height="20" />
        <span>Continue with Google</span>
      </button>
      {busy && (
        <p className="visually-hidden" role="status">
          Opening Google…
        </p>
      )}
    </div>
  );
}
