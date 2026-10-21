export function SetupSignOut({
  onSignOut,
  signingOut,
}: {
  onSignOut: () => void;
  signingOut: boolean;
}) {
  return (
    <button
      type="button"
      className="text-button setup-sign-out"
      onClick={onSignOut}
      disabled={signingOut}
    >
      {signingOut ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
