# Client

A static React application served by Workers Assets. [Welcome](features/welcome/README.md) handles email login and logout, then mounts [member screens](features/people/README.md). These compose [invitations](features/invitations/README.md) and [avatars](features/avatars/README.md), using the shared [API client](api/README.md).

Global styling lives in `styles.css`; [interface guidance](../../docs/design.md) requires a plain, utilitarian UI. No local auth bypass, persisted private content, or service worker exists. Verification uses API and static checks; browser and visual testing are prohibited.
