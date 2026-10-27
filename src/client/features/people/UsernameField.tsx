export function UsernameField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <>
      <label className="field-label" htmlFor="handle">
        Username
      </label>
      <input
        id="handle"
        value={value}
        onChange={(event) => onChange(event.target.value.toLowerCase())}
        pattern="[a-z0-9_]{3,30}"
        minLength={3}
        maxLength={30}
        required
        disabled={disabled}
        autoCapitalize="none"
        autoComplete="username"
        aria-describedby="handle-help"
      />
      <p id="handle-help" className="field-help">
        3–30 letters, numbers, or underscores.
      </p>
    </>
  );
}
