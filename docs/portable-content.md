# Standalone authored-document delivery

Tiptap/ProseMirror JSON is the canonical HaloPress revision and editing format. HaloPress exposes that same validated JSON through two rendering boundaries:

- HaloPress Site renders JSON with code-owned Vue components during Nuxt SSR, hydration, and client navigation. It inherits width, outer spacing, background, typography, foreground color, and color mode from the effective Site Layout and Theme.
- Document APIs additionally serialize safe partial HTML on the server for consumers that do not run Vue, Nuxt UI, Tailwind, the editor, or HaloPress application code.

The Site renderer never fetches or injects the standalone HTML projection. Site requests use the JSON-only form of the existing delivery endpoints, so displaying a Site route does not run the standalone serializer or transfer duplicate HTML.

## Version 2 API envelope

`GET /api/delivery/page/:id` preserves raw `content` and includes a server-generated `rendering` projection by default:

```json
{
  "id": "welcome",
  "content": { "type": "doc", "content": [] },
  "rendering": {
    "contractVersion": 2,
    "html": "<article class=\"halo-content halo-page\" data-halo-contract-version=\"2\">…</article>",
    "stylesheets": [
      "https://site.example/_halo/content/v2/STYLESHEET_SHA256.css"
    ],
    "outline": []
  }
}
```

Public `GET /api/content/:schemaKey/:id` responses retain structured `content` and include the same v2 contract with a `fields` map for every rich-text field owned by the exact returned Schema version. Authenticated preview endpoints expose the projection only after authorization and remain `private, no-store` and `noindex`.

The v2 HTML is a fragment, not a complete document. It contains semantic elements, fixed `halo-*` classes, allowlisted `data-halo-*` values, and renderer-owned SVG geometry. Author-provided HTML, classes, styles, IDs, event handlers, scripts, component names, and runtime selectors are never copied into the output.

The fragment and stylesheet do not contain a color-mode selector, `color-scheme`, a document background, or a default foreground declaration. Ordinary text, headings, and lists inherit from the embedding consumer. Semantic blocks may retain explicit surfaces and contrast colors required by their finite block contract. Changing only a light/dark preference therefore cannot change serialized fragment bytes.

The plain-HTML consumer at [`examples/portable-content/index.html`](../examples/portable-content/index.html) demonstrates the contract. Configure its fixed trusted HaloPress origin, serve the file from any static origin, and enter a published Page ID.

## Native Site renderer

Page and rich-text Site components normalize JSON through `shared/authored-document.ts` and render its finite node/mark union recursively in Vue. Stored strings never select components, imports, classes, slots, Nuxt UI payloads, or executable behavior. Legacy `pageBlock` nodes still resolve through the existing exhaustive Page-block registry and receive a code-owned wrapper anchor for TOC navigation.

The structural `pageHero` node is a separate allowlisted top-level container. It accepts only `orientation` and `reverse`, validates its finite child sequence, renders children through the same native/standalone node mapping, and rejects temporary `imageUpload` content at the public boundary. Legacy `pageBlock` values whose component is `pageHero` remain unchanged.

Heading IDs are allocated from normalized text in deterministic document order. Stored IDs are ignored. Ordinary and structural-hero IDs are placed on their semantic headings; legacy Page blocks use the wrapper anchor. Structured fields include a stable field discriminator so headings from different fields cannot collide.

Malformed, retired, over-depth, cyclic, or oversized content produces a deterministic visible fallback. Raw JSON remains unchanged in the API response and stored revision.

## URLs, assets, and response identity

Absolute standalone URLs are derived at request time from the trusted canonical origin. Links allow safe HTTP(S), mail, telephone, and fragment destinations. Rich-text media must resolve to the delivery origin, while Page-block media and logos use the narrower `/assets/:id/raw` contract. Credentials, executable schemes, protocol-relative URLs, conflicting forwarding authority, and unchecked private paths are rejected.

The v2 stylesheet URL contains the SHA-256 of its exact bytes and is served append-only with immutable caching, a strong ETag, wildcard read-only CORS, `Cross-Origin-Resource-Policy: cross-origin`, and `nosniff`. Public JSON envelopes retain their existing strong ETag and origin-aware `Vary` behavior. Mutable assets retain revalidation semantics.

## Version 1 compatibility

The content-addressed v1 stylesheet, route, serializer bytes, outline allocation, malformed fallbacks, and legacy Page-block behavior remain immutable for existing consumers. New Page and Content API envelopes default to contract v2. Consumers should switch on `rendering.contractVersion`, load the advertised stylesheet list in order, and replace older links when an envelope advertises a new revision.

Version 1 combined a standalone document surface with Theme/color-mode presentation. Version 2 deliberately removes that coupling. Theme manifests and Theme stylesheets remain separate public resources, but v2 document fragments do not advertise or require them. A consumer may apply its own outer Theme without changing the fragment contract.
