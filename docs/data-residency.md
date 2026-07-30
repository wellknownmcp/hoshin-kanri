# Where your strategy lives

"Where does my strategy live?" is the first question a serious user asks about a
strategic planning tool, and the honest answer is usually uncomfortable: on
someone else's server, forever.

This server is built so that the answer is a **choice**, and so that choosing
the strictest option costs you nothing in capability.

## Three transports, three levels of residency

The MCP tool surface is deliberately **agnostic of storage**. Same 11 tools,
same 9 prompts, same completeness score — the agent cannot tell where the data
lives, because the tool contract is identical.

| Transport | Your data lives | Requires |
|---|---|---|
| `index-local.js` | **plain JSON files on your machine** (`~/hoshin-data/`) | nothing — no account, no network |
| `index-stdio.js` | the hosted API, accessed from your machine | an account + a token |
| `index-streamable-http.js` | the hosted API, multi-tenant | an account + OAuth 2.1 |

Local mode is the default binary of the npm package. That ordering is the
argument: sovereignty is not the degraded tier.

## What local mode actually guarantees

- **No network.** The local transport has no HTTP client for your data. There is
  nothing to intercept because nothing is sent.
- **No account, no telemetry, no analytics.** Nothing to register, nothing
  phoning home.
- **The files are the export.** Plain JSON, one file per aggregate, in a
  directory you chose. Readable, greppable, diffable, and versionable in your own
  git repository. There is no export button because there is nothing to export
  *from*.
- **Deletion is `rm`.** Not a support ticket and not a 30-day retention window.

Details of the store that matter if you are trusting it with the only copy of
something: writes are atomic (write to a temporary file, then rename), mutated
through an in-process mutex to serialise concurrent tool calls, one file per
aggregate so a corrupted write cannot take the whole dataset with it. See
[`mcp-server/lib/json-store.js`](../mcp-server/lib/json-store.js).

Back it up like any other directory of important files. Local mode moves the
responsibility to you; it does not remove it.

## The one thing local mode will not do

`share_matrix` — publishing a matrix as a public read-only web page — is
**refused** in local mode, and returns an error saying so.

This is not an unimplemented feature. Publishing requires a server to publish
to, and standing one up would silently undo the guarantee. When you need to send
a matrix to someone in sovereign mode, use the `matrix_artifact` prompt: your
agent renders a self-contained interactive snapshot that you send deliberately,
once, to a recipient you chose — rather than a URL that keeps serving your
strategy until you remember to revoke it.

## Why the business logic is kept in lockstep

`lib/completeness.js` — the scoring engine — is pure: elements and correlations
in, a score out, no I/O. The local store and the hosted API run the same
algorithm, and the web application holds a TypeScript twin of it because an npm
package cannot import the app's sources.

Two copies of anything drift. So a test in the web application feeds the same
matrix to both and asserts an identical score, an identical level and an
identical list of suggestion codes: if the hosted engine gains a rule the
sovereign one lacks, CI fails rather than local mode quietly becoming a
second-class citizen — which is how a sovereignty argument turns into a
marketing claim. Local mode is either the same product or it is a lie.

The same reasoning applies to the tool and prompt schemas, genuinely shared
(imported, single copy) across all three transports in
[`lib/`](../mcp-server/lib/), with only the handlers differing.

## The value split this reflects

The intended division is explicit, because it determines what a vendor is
tempted to hold hostage:

- **Your context is yours** — the strategy itself, the objectives, the
  correlations, the history of what you decided and why. It stays with you at
  every level, including the hosted ones.
- **The structuring is the product** — the score, the cadence architecture, the
  deployment diagnosis, the prompts that make an agent useful rather than
  agreeable.
- **The code is a commodity.** It is MIT-licensed and in this repository. Read
  it, fork it, run it forever.

A tool whose retention depends on holding your data has an incentive to make
leaving hard. A tool whose retention depends on being genuinely useful does not
need to.

## Hosted mode, for completeness

If you do choose the hosted transports, the properties that apply: EU hosting,
strict per-organization isolation on every query, an audit trail of privileged
operations, and **no use of your data for model training** — the LLM in the loop
is *yours*, reaching this server through your own MCP client, not a model we
call on your behalf.

For contractual specifics (DPA, sub-processors, retention), contact
<contact@animam-technologies.com>.
