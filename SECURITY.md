# Security policy

## Reporting a vulnerability

Email <security@hoshin.app>. Please do not open a public issue for anything
exploitable. The same address is published in
<https://hoshin.app/.well-known/security.txt> (RFC 9116).

Mail to this address is read by a person. Unlike our other inboxes, it is never
handed to the assistant that drafts replies, so the details of a report do not
leave us.

Include what you need to make the report actionable: the affected transport
(local JSON over stdio, or Streamable HTTP) or the hosted endpoint, what you observed, and
how to reproduce it. We will acknowledge within a few working days.

## Scope

In scope:

- this repository — the two MCP transports and the shared `lib/`;
- the hosted MCP endpoint `https://hoshin.app/mcp` and the OAuth 2.1
  authorization server it discovers
  (`/.well-known/oauth-authorization-server`, `/.well-known/jwks.json`,
  `/.well-known/oauth-protected-resource`);
- the tokenised public share pages (`/share/matrix/<token>`).

Please do not run load or denial-of-service tests against the hosted endpoint,
and use only accounts and matrices you own.

## Design notes relevant to review

- The HTTP transport holds **no key material and no secret**. Bearer credentials
  — opaque API tokens (`hk_*`, stored SHA-256 hashed) and OAuth 2.1 JWTs — are
  validated by the application via `POST /api/auth/validate-token`, then
  forwarded unchanged to `/api/*`.
- A token's effective role is derived from its permissions or scopes and then
  **capped by the user's real role**: a token can never grant more than its
  owner has.
- In local JSON mode there is no authentication and none is claimed: the trust
  boundary is your filesystem, and the transport speaks stdio to a client you
  launched yourself.
