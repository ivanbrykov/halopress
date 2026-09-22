# Page Block Library authoring models

The Page editor uses three authoring models. Authors see these names in the
Block Library before insertion.

- **Configured block** — a finite interaction or collection whose consistency
  is the product. Its semantic configuration remains in Inspector.
- **Editable unit** — a code-owned parent keeps a small structural relationship,
  while its authored children remain ordinary editable Tiptap content.
- **Editable pattern** — a reviewed Tiptap JSON fragment is copied into the
  document and immediately becomes ordinary independent content.

## Shipped classification

| Entry | Model | Rationale |
| --- | --- | --- |
| Centered hero | Editable unit | The parent controls orientation; headline, copy, links, and optional media remain canvas-editable children. |
| Split hero | Editable unit | The parent preserves the text/media relationship without hiding authored content in attributes. |
| Feature list | Editable pattern | Heading, explanation, and feature items are ordinary rich text. |
| Media and content | Editable pattern | Copy and links are ordinary content; authors add or replace media with the normal Image tool. |
| Testimonial and social proof | Editable pattern | Quote and attribution are editable; only the finite logo collection remains configured. |
| Frequently asked questions | Configured block | A finite accordion item list preserves reviewed keyboard interaction. |
| Closing call to action | Editable pattern | Heading, description, and link labels are directly editable text. |
| Marketing starter page | Editable pattern | The complete starter is copied as editable content with one configured FAQ. |
| Logo collection | Configured block | Asset selection, alternative text, and ordering form one finite collection contract. |

The historical `pageHero`, `pageCard`, `pageSection`, `pageTestimonial`, and
`pageCTA` atoms are no longer offered as new library entries. They remain
registered so stored drafts and publication revisions continue to load and
render without rewriting. `pageFAQ` and `pageLogos` remain configured atoms.

## Editable Hero contract

`pageHero` is a non-atomic, selectable top-level node. It stores only
`orientation` (`vertical` or `horizontal`) and `reverse` (boolean). Its strict
child expression is `paragraph? heading paragraph+ (image | imageUpload)?`.
The edit NodeView exposes those children through a real `NodeViewContent`; only
its editor label is non-editable.

Normal text, mark, link, and image commands therefore operate on Hero children.
Changing orientation in Inspector updates only the parent attributes and does
not replace or flatten child content.

An existing atomic `pageHero` can be converted intentionally in one undoable
transaction. The conversion preserves headline, title, description, safe links,
media, alternative text, orientation, and reverse order. Conversion is blocked
when non-empty `advanced` data cannot be represented losslessly.

## Pattern validation and insertion

Pattern contract version 2 stores an allowlisted `JSONContent` fragment. The
live Page editor schema is authoritative: insertion deep-clones each node,
parses it with `schema.nodeFromJSON()`, runs ProseMirror `node.check()`, and
checks the top-level document content expression before one transaction is
dispatched. This avoids maintaining a second hand-written Page schema.

Shared checks cover only constraints ProseMirror does not express: document
size/depth budgets, forbidden runtime keys, safe stored links and assets, finite
Hero attributes, and the configured-block allowlist.
Patterns cannot store HTML, CSS, utility classes, component selectors, Nuxt UI
`ui` payloads, scripts, event handlers, or remote executable definitions.

Split Hero and media patterns may insert the existing `imageUpload` authoring
node so the normal Image flow is available at the intended location. Drafts may
hold that temporary node, while publication rejects it until upload resolves to
an ordinary `image` node.

After insertion, the selection is a text caret in the first editable text block.
The whole fragment is inserted in one transaction, so one immediate undo removes
the insertion. Click, keyboard, touch, and drag/drop all call the same command and
use generic inserted-content scrolling rather than assuming an atomic block.

## Compatibility and upgrades

Pattern insertion is **copy-on-insert**. Pattern identity and version are not
stored as a live template relationship. Updating a definition changes future
insertions only.

Existing pages are never rewritten automatically. Historical atomic blocks keep
their existing JSON and renderer behavior. There is no database migration for
this document-schema evolution.

Public/native/portable serialization of the new semantic `pageHero` wrapper is
owned by issue #93. This issue fixes the editor-side NodeSpec contract and does
not introduce a parallel public renderer.

## Authoring fixtures

Registry-derived fixtures continue to cover every pattern at desktop light mode
(1280 × 900) and mobile dark mode (390 × 844). Authoring interaction tests cover
schema-backed insertion, caret placement, inline marks, structural Inspector
updates, one-step undo, legacy conversion, and malformed fragment rejection.
