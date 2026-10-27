import type { TextareaHTMLAttributes } from 'react';

// Text edited in place, in the type of the page text it previews. A hidden
// copy sizes the field so it wraps and grows like that text.
export function InlineField({
  multiline = false,
  value,
  placeholder,
  ...field
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  multiline?: boolean;
  value: string;
  placeholder: string;
}) {
  return (
    <span className="inline-field editable">
      <span className="inline-field-size" aria-hidden="true">
        {(value || placeholder) + ' '}
      </span>
      <textarea
        {...field}
        rows={1}
        value={value}
        placeholder={placeholder}
        onKeyDown={(key) => {
          if (!multiline && key.key === 'Enter') key.preventDefault();
        }}
      />
    </span>
  );
}

// Single-line fields turn pasted line breaks into spaces.
export const oneLine = (value: string) => value.replace(/\r?\n/g, ' ');
