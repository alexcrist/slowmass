# Avatar form

Uploads one JPEG, PNG, or WebP to the authenticated avatar endpoint. Each file selection generates an idempotency key retained across network retries. Server limits and processing remain authoritative. The image is fetched only through the private media route; no public preview or third-party host is used.
