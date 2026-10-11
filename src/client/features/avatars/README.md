# Avatar form

Uploads one JPEG, PNG, or WebP to the authenticated avatar endpoint. Each file selection generates an idempotency key retained across network retries. Server limits and processing remain authoritative. The image is fetched only through the private media route; no public preview or third-party host is used.

The form is under Settings → Edit profile. Successful upload/removal updates the parent profile's avatar state so returning to the form stays consistent. The form discloses that avatars are visible to signed-in members, subject to blocks.
