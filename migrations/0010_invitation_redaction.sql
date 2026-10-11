-- Only account deletion may redact a recipient address; actor IDs and times stay immutable.
DROP TRIGGER invitation_immutable_provenance;
CREATE TRIGGER invitation_immutable_provenance BEFORE UPDATE OF id, inviter_id, recipient_email, created_at ON invitation
BEGIN
 SELECT CASE WHEN NEW.id IS NOT OLD.id OR NEW.inviter_id IS NOT OLD.inviter_id OR NEW.created_at IS NOT OLD.created_at
 OR (NEW.recipient_email IS NOT OLD.recipient_email AND NOT EXISTS(
 SELECT 1 FROM account_deletion d JOIN membership m ON m.user_id=d.user_id
 WHERE m.status='deleted' AND d.email_to_redact=OLD.recipient_email AND NEW.recipient_email='deleted:'||d.user_id
 )) THEN RAISE(ABORT,'immutable_invitation_provenance') END;
END;
