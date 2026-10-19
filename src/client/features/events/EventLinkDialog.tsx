import { Dialog } from '../../ui/Dialog';
import { CopyLink } from '../../ui/CopyLink';

// The event's one URL with a copy button.
export function EventLinkDialog({
  url,
  onClose,
}: {
  url: string;
  onClose: () => void;
}) {
  return (
    <Dialog title="Event link" onClose={onClose}>
      <p className="event-link-description">
        Send the link to your friends to invite them.
      </p>
      <CopyLink url={url} label="Event link" />
    </Dialog>
  );
}
