# HaloPress Korean search tokenizer

This private workspace package is the single tokenizer contract shared by the
HaloPress search indexer Worker and optional browser query mode.

## Decision

HaloPress uses a thin adapter over MIT-licensed `garu-ko@0.9.11`.

- Direct Garu use was rejected because normalization, POS selection, limits,
  raw-term fallback, and generation checks would be duplicated by consumers.
- A Worker-specific fork is unnecessary because `garu-ko/browser` has no Node
  built-ins and accepts explicit `modelData`. The auxiliary Worker loads those
  bytes from its own asset binding.
- A second pure-TypeScript Korean analyzer was rejected because maintaining a
  separate language model and parity corpus would add more risk than the small
  adapter.

The pinned model is 1,438,231 bytes and has SHA-256
`5186b7ccf18bd1544523f408f1b7aa2a14b09b1c2d27ce96185afd49aa08e741`.
The upstream WASM engine is 401 KB raw. Browser code dynamically imports the
package and fetches the model only after search intent; the main HaloPress
Worker never imports this entry.

## Profile

Input is NFC-normalized, control/zero-width characters become spaces, and
whitespace collapses. Raw terms preserve ordered Korean, Latin, numeric, URL,
and identifier-shaped tokens. Morphological terms preserve order and
frequency, keeping Sejong lexical POS categories: nouns, pronouns, numerals,
verbs, adjectives, auxiliaries/copulas, modifiers/adverbs, interjections,
foreign/Chinese/numeric terms, and roots. Particles, endings, punctuation, and
symbols are excluded.

The public generation string includes the contract, engine, model digest,
profile, and NFC rules. A generation change requires a rebuild; mismatched
browser terms are rejected.

## Limits and chunks

- Query text: 512 UTF-8 bytes.
- Query terms: 64, each at most 128 UTF-8 bytes.
- Analyzer chunk: 24 KiB.
- Plain-text extraction: 1 MiB before an explicit truncated result.

`splitTokenizerChunks()` segments deterministically at sentences before falling
back to code-point boundaries. Index state persists after every chunk; callers
must never treat partial chunks as active.

## Benchmarks

Run `pnpm --filter @halopress/korean-search-tokenizer benchmark` on Node and the
auxiliary Worker benchmark endpoint. Record cold model initialization, warm
query analysis, 5/10/50/75-sentence CPU, bytes, token count, and memory where
the runtime exposes it. The 24 KiB default is intentionally below the input
used for the 50+ sentence acceptance sample; Queue consumer CPU is selected
over Free Workflow steps because the latter's 10 ms step budget is too narrow
for cold initialization and realistic long chunks.

The 2026-07-23 Node 24.13.0 baseline on the development machine measured
49.0 ms cold initialization and 0.23 ms warm short-query analysis. Repeated
434/869/4,349/6,524-byte samples containing 5/10/50/75 sentences took
12.1/13.2/185.7/302.9 ms wall time. These are sizing evidence, not Cloudflare
CPU guarantees; the auxiliary Worker benchmark is the production check.
