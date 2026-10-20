# Event appearance contract

The client and server share curated palette and font-pairing identifiers and their runtime validator. The event feature owns presentation and persistence. Only IDs cross the API; arbitrary CSS, colors, or font URLs are never accepted. Database checks enforce the current allowlist while retaining the previous font column for deployment compatibility. The server maps retired saved choices into the current catalog; the API accepts only current IDs. New events default to the original appearance.
