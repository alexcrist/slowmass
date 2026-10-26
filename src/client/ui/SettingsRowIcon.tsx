// Line icons that lead Settings rows, drawn like the navigation icons.
const paths = {
  profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM5 20a7 7 0 0 1 14 0',
  photo:
    'M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1ZM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7',
  // The envelope of MailIcon, which opens the same invite link on profiles.
  invite:
    'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM3.5 6.5l8.5 7 8.5-7',
  notifications: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4ZM10 21h4',
  install: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  blocked: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM5.6 5.6l12.8 12.8',
  signOut: 'M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M14 8l4 4-4 4M18 12H9',
  delete: 'M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
} as const;

export function SettingsRowIcon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      className="settings-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}
