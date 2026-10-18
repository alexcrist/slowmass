export type Answer = 'going' | 'maybe' | 'declined';
export const answers: { value: Answer; label: string }[] = [
  { value: 'going', label: 'Going' },
  { value: 'maybe', label: 'Maybe' },
  { value: 'declined', label: 'Can’t go' },
];
// Decoration chosen by the owner; hidden from assistive technology.
export const answerEmoji: Record<Answer, string> = {
  going: '🪩',
  maybe: '🎲',
  declined: '🫠',
};
export type Host = {
  handle: string;
  displayName: string;
  hasAvatar: boolean;
  // The creator always hosts; other hosts can be removed or leave.
  isCreator: boolean;
  isViewer: boolean;
};
export type EventDetails = {
  id: string;
  title: string;
  description: string;
  location: string;
  startsAt: number;
  endsAt: number | null;
  timeZone: string;
  width: number;
  height: number;
  cancelled: boolean;
  over: boolean;
  photoUrl: string;
  thumbnailUrl: string;
};
export type EventView = EventDetails & {
  hosts: Host[];
  // Emails hosts added that have not become hosts yet; empty for guests.
  pendingHosts: string[];
  // Only hosts and people who answered see how others answered.
  counts: Record<Answer, number> | null;
  // The event's one URL; null when the credential cannot be recovered.
  url: string | null;
  viewer: {
    isHost: boolean;
    isCreator: boolean;
    // A host added this member's email; accepting makes them a host.
    hostInvited: boolean;
    response: Answer | null;
  };
};
export type EventItem = EventDetails & {
  isHost: boolean;
  response: Answer | null;
};
export function yourAnswer(isHost: boolean, response: Answer | null) {
  if (isHost) return 'You’re hosting';
  return response === 'going'
    ? 'You’re going'
    : response === 'maybe'
      ? 'You might go'
      : response === 'declined'
        ? 'You can’t go'
        : 'You’re invited';
}
