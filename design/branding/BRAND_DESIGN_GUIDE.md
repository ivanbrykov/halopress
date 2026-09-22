# HaloPress Brand Design Guide

## 1. Locked scope

- Theme: `grape-sky`
- Primary paper color: light lilac
- Secondary paper color: luminous sky blue
- Center spark: transparent knockout, never white or black fill
- Paper geometry: both paper forms must have the same size and the same intrinsic aspect ratio
- Overall master composition: square (`1:1`)
- Master format: raster PNG with alpha
- Vectorization: prohibited for this work
- Artwork derivation: every downstream asset must be generated from the approved raster master
- Intermediate outputs: preserve; do not overwrite or delete

## 2. Protected references

These reference files are read-only inputs. Do not edit, resize, crop in place, or overwrite them.

| File | Dimensions | SHA-256 |
| --- | --- | --- |
| `design/branding/halopress-theme-grape-sky.png` | 1774 × 887 RGB PNG | `3b22aaf6dd0c50344dedb6ea156223c75ebcc3cc806a039fc63b56c1a1a33136` |
| `design/branding/halopress-theme-plum-coral.png` | 1536 × 1024 RGB PNG | `52c259f302914c23c660faf0ac8d24d515fdfa0ee2543c505f248b2204a4eb51` |

The `plum-coral` reference is retained for recovery and comparison only. It is outside the selected production scope.

## 3. Working directory

All new work is isolated under:

`design/branding/grape-sky-lilac-raster/`

### Production recovery set

The committed recovery set contains only the approved production lineage:

- protected `halopress-theme-grape-sky.png` reference
- approved candidate 07 through 09 raster inputs and chroma-removal/color-tuning scripts
- `02-final-master/halopress-mark-master-v2.png`
- selected `exports/brand-background-light.png` and `exports/brand-background-dark.png`
- `background-wizard-03-freeform.png`
- `build-derived-artwork-v2.mjs`

Rejected candidates, superseded layouts, backups, comparison sheets, and validation images are preserved locally under:

`design/branding/archive/brand-rebranding-2026-07-23/`

The archive retains each file's original path beneath that root and is intentionally excluded from Git. Historical paths in this document that are not part of the production recovery set can be resolved by prepending the archive root above.

Stages:

1. `01-master-candidates/` — untouched image-generation outputs and prompts
2. `02-final-master/` — selected chroma source and transparent raster master
3. `03-artwork-sources/` — generated backgrounds or artwork sources derived from the master
4. `04-deliverables/` — favicon, site marks, social card, and final site artwork
5. `05-validation/` — contact sheets, browser-tab previews, checksums, and validation notes

## 4. Recovery rules

1. Never edit the protected references.
2. Never overwrite a candidate. Add a numbered version (`candidate-01`, `candidate-02`, and so on).
3. Never delete rejected candidates or intermediate chroma sources.
4. Do not update `public/` until the raster master passes the geometry and transparency checks.
5. Before updating `public/`, copy final deliverables into `04-deliverables/`.
6. Record every generation prompt, source path, output path, and validation result in this document.
7. `02-final-master/halopress-mark-master.png` was rejected after visual review and must not be used as a recovery point.
8. Until a replacement is explicitly approved, recovery starts from the protected `grape-sky` reference and the preserved files in `06-original-redesign/`.

## 5. Geometry acceptance criteria

- Canvas is square.
- Both paper forms have visibly equal width and height.
- Neither paper is stretched, enlarged, or shrunk independently.
- The canvas is square, while the mark preserves the original `grape-sky` tall composition and generous surrounding margin.
- The papers must not be enlarged relative to the center spark.
- The center spark must preserve the original reference's width, height, point lengths, and unwarped eight-point character.
- The center spark is a clean transparent knockout.
- The knockout does not create stray tears, spikes, or disconnected edge artifacts.
- The mark remains recognizable at 16, 32, and 64 pixels.
- Light lilac and sky blue remain distinguishable on both light and dark browser-tab backgrounds.

## 6. Process log

### Stage 0 — preservation baseline

- Date: 2026-07-23
- Branch: `feat/brand-rebranding-assets`
- Protected reference hashes recorded above.
- Previous failed derivatives remain present and are not treated as production inputs.
- A previous vector reconstruction attempt was removed. Vectorization is explicitly prohibited from this point onward.

### Stage 1 — raster master candidates

Status: in progress.

#### Candidate 01

- Mode: built-in `image_gen`
- Input: `design/branding/halopress-theme-grape-sky.png` (primary visual reference)
- Intended output: square raster master candidate on flat `#00ff00`
- Saved workspace path: `design/branding/grape-sky-lilac-raster/01-master-candidates/candidate-01-chroma.png`
- Dimensions: 1254 × 1254 RGB PNG
- SHA-256: `c0f3314eab3ad271b41028a5c67a8d7fbc58fb29f83b4e21ff3b645952cf4225`
- Result: rejected but preserved
- Reason: correct light-lilac/sky palette and knockout intent, but the combined silhouette remains too tall because the vertical offset is excessive. It does not pass the near-square composition criterion.
- Prompt:

```text
Use case: logo-brand
Asset type: final square raster brand-mark master
Primary request: Rebuild the HaloPress open-paper-and-spark mark from the grape-sky reference as a clean raster master in the light-lilac grape-sky colorway.
Input images: Image 1: protected shape, curve, overlap, and color-language reference
Scene/backdrop: perfectly flat solid #00ff00 chroma-key background
Subject: exactly two congruent paper forms opening around a centered eight-point spark
Geometry: both paper forms must be duplicates of the same intrinsic shape with exactly equal width, equal height, equal curve proportions, and equal visual area; one may be rotated 180 degrees and repositioned, but neither may be scaled, stretched, enlarged, or shrunk independently
Composition/framing: square 1:1 canvas; arrange the two equal paper forms so the combined exterior bounding silhouette is close to square; fill approximately 94% of the canvas with minimal antialias-safe clearance
Color palette: light lilac paper and luminous sky-blue paper
Center: the eight-point spark is a true visual knockout rendered in exactly #00ff00, the same as the background, with no white or black fill
Style/medium: polished high-resolution raster brand artwork with clean flat gradients; preserve the reference's page curves and portal impression
Constraints: one isolated mark only; no text; no wordmark; no shadows; no reflection; no border; no tile; background must be uniform #00ff00; no green inside the papers
Avoid: unequal paper sizes, tall narrow composition, white star, black star, extra spikes, torn edges, vector wireframes, 3D bevels, watermark
```

#### Candidate 02

- Mode: built-in `image_gen` edit
- Input 1: `candidate-01-chroma.png` (edit target)
- Input 2: protected `halopress-theme-grape-sky.png` (shape-language reference)
- Intended change: move the two existing paper forms only; keep each paper's pixels, size, and proportions stable
- Saved workspace path: `design/branding/grape-sky-lilac-raster/01-master-candidates/candidate-02-chroma.png`
- Dimensions: 1254 × 1254 RGB PNG
- SHA-256: `c020dc11b97fea8b05b10b8e11f722eeff9fc7a79d23dfcb34d160461254c112`
- Result: rejected but preserved
- Reason: the overall silhouette is substantially closer to square, but the sky paper is visibly smaller than the lilac paper and therefore violates the equal-size invariant.
- Prompt:

```text
Use case: precise-object-edit
Asset type: final square raster brand-mark master candidate
Primary request: Change only the relative positions of the two paper forms in Image 1 so the combined mark has a near-square exterior silhouette.
Input images: Image 1: edit target; Image 2: protected curve and brand-language reference
Keep unchanged: each paper's individual width, height, intrinsic aspect ratio, curve profile, gradient, light-lilac and sky-blue colors, central eight-point knockout shape, flat #00ff00 background, raster finish
Position change only: move the lilac paper farther left and slightly upward; move the sky-blue paper farther right and slightly downward; reduce the total vertical offset and increase the horizontal spread until the combined non-background bounding box is approximately square
Geometry invariant: the two papers must remain congruent and equally sized; no scaling, stretching, cropping, redrawing, or independent resizing
Composition: center the combined square-like mark and fill approximately 94% of the canvas
Constraints: exactly two papers; center remains #00ff00 knockout; background remains perfectly uniform #00ff00; no text; no shadow; no extra elements
Avoid: any changed paper size, any changed curve, tall composition, white or black star, extra spikes, torn edges, vectorization, watermark
```

#### Candidate 03

- Mode: built-in `image_gen` edit
- Input 1: `candidate-02-chroma.png` (edit target)
- Input 2: protected `halopress-theme-grape-sky.png` (shape-language reference)
- Intended change: equalize only the sky paper dimensions to the fixed lilac paper
- Saved workspace path: `design/branding/grape-sky-lilac-raster/01-master-candidates/candidate-03-chroma.png`
- Dimensions: 1254 × 1254 RGB PNG
- SHA-256: `947d940e54458dc0865cd43797bb60b8c83a9534d6d26b0cfa61d28446a3a1c6`
- Result: rejected but preserved
- Reason: both papers now share the same vertical extent, but the lilac paper remains visibly wider. Repeated free generation is not accepted as a way to enforce exact geometry.
- Prompt:

```text
Use case: precise-object-edit
Asset type: final square raster brand-mark master candidate
Primary request: Change only the sky-blue paper in Image 1 so it has exactly the same width, height, intrinsic aspect ratio, curve proportions, and visual area as the light-lilac paper.
Input images: Image 1: edit target; Image 2: protected brand-language reference
Fixed invariant: the light-lilac paper is the dimensional reference and must remain pixel-for-pixel unchanged in size, shape, position, color, and gradient
Change only: enlarge and position the sky-blue paper until it is congruent with the lilac paper; preserve the sky paper's existing curve language and color
Keep unchanged: square canvas, near-square combined composition, central eight-point #00ff00 knockout, uniform #00ff00 background, raster finish
Geometry invariant: after the change, both papers must have equal width and equal height; do not redraw the lilac paper; do not alter the spark
Constraints: exactly two papers; no text; no shadows; no border; no extra elements
Avoid: unequal papers, altered lilac paper, white or black star, torn edges, vectorization, watermark
```

#### Raster paper template 01

- Mode: built-in `image_gen` edit
- Input: `candidate-03-chroma.png`
- Purpose: create one clean lilac paper raster that can be duplicated exactly
- Chroma source: `design/branding/grape-sky-lilac-raster/01-master-candidates/paper-template-01-chroma.png`
- Alpha source: `design/branding/grape-sky-lilac-raster/01-master-candidates/paper-template-01-alpha.png`
- Dimensions: 1254 × 1254
- Chroma SHA-256: `15fd0e7f74735aa6171597e1dc77bafc4b10ae97bba1e338a8faf18fa8faa143`
- Alpha SHA-256: `5e20654b8ef41187b5b8201e9dcc841f619f5f7b6a9442cf8e0a2b6ccbcdf6ff`
- Background removal: built-in image generation followed by `remove_chroma_key.py` with border auto-key, soft matte, thresholds 12/220, and despill
- Result: accepted as the single-paper raster template
- Prompt:

```text
Use case: precise-object-edit
Asset type: single raster paper template for a brand-mark master
Primary request: Keep only the light-lilac paper from Image 1 and restore it as one complete, uninterrupted paper form.
Input images: Image 1: edit target
Keep unchanged: the lilac paper's exact outer silhouette, width, height, curve profile, position, gradient, raster texture, and antialiased edge
Change only: remove the sky-blue paper completely; fill the star-shaped missing area inside the lilac paper with a seamless continuation of the surrounding lilac gradient
Scene/backdrop: preserve the perfectly uniform #00ff00 background
Result: exactly one complete lilac paper on #00ff00, with no star hole and no second paper
Constraints: no scaling, no stretching, no redrawing of the outer edge, no repositioning, no shadow, no text, no extra object
Avoid: changed paper proportions, sky-blue remnants, star cutout, new curves, vectorization, watermark
```

After background removal, this single raster paper will be duplicated without resampling. The duplicate will be rotated 180 degrees and recolored to sky blue. The two layers will therefore share the exact same pixel dimensions and intrinsic proportions.

#### Spark mask 01

- Mode: built-in `image_gen`
- Inputs: protected `halopress-theme-grape-sky.png` and `candidate-01-chroma.png`
- Purpose: generate a reusable raster-only eight-point knockout mask
- Saved workspace path: `design/branding/grape-sky-lilac-raster/01-master-candidates/spark-mask-01.png`
- Dimensions: 1254 × 1254 RGB PNG
- SHA-256: `97b956a04f775587a13949ec844ea43addbf45357e2c166a18b6b5e5192a0765`
- Result: accepted as the raster knockout-mask source
- Prompt:

```text
Use case: logo-brand
Asset type: monochrome raster mask source
Primary request: Isolate the centered eight-point HaloPress spark shape from the references as one clean solid-white raster symbol.
Input images: Image 1: protected spark-shape reference; Image 2: supporting generated spark reference
Scene/backdrop: perfectly flat solid black square background
Subject: exactly one centered eight-point spark, solid white, with four long cardinal points and four slightly shorter diagonal points matching the HaloPress reference character
Composition: square canvas; spark fills approximately 72% of the canvas; centered with equal padding
Style: crisp high-resolution raster silhouette with clean antialiased edges
Constraints: only black and white; no gradients; no glow; no shadow; no text; no border; no extra points; no other objects
Avoid: star outlines, irregular torn edges, more or fewer than eight points, vector wireframe, watermark
```

#### Raster master assembly 01

- Inputs:
  - `paper-template-01-alpha.png`
  - `spark-mask-01.png`
- Operations:
  1. Crop the paper template to its alpha bounds without resampling.
  2. Duplicate the exact cropped pixel layer.
  3. Rotate the duplicate 180 degrees without scaling.
  4. Recolor only the duplicate RGB channels to sky blue; keep its alpha unchanged.
  5. Place both 677 × 980 paper layers on a 1254 × 1254 canvas with the same vertical position and a 303-pixel horizontal offset. Their combined 980 × 980 bounds are square.
  6. Scale the raster spark-mask crop uniformly and subtract it from the combined alpha.
- Prohibited operations: vector paths, independent paper scaling, non-uniform transforms, paper-edge redrawing
- Intermediate outputs:
  - `02-final-master/paper-template-01-cropped.png`
  - `02-final-master/paper-template-01-sky-rotated.png`
  - `02-final-master/master-assembly-01-no-knockout.png`
  - `02-final-master/spark-mask-01-fitted.png`
  - `02-final-master/candidate-04-master.png`
- Candidate 04 SHA-256: `e954f8bdd177ad0d3e41a121f55a3536a0d16260a5763d47b8946038b948bb5c`
- Result: rejected but preserved
- Reason: the 980 × 980 exterior bounds and equal paper geometry pass, but the lilac foreground layer covers the center. The spark therefore appears inside one paper instead of crossing the boundary between both papers.

#### Raster master assembly 02

- Inputs: the same `paper-template-01-cropped.png`, `paper-template-01-sky-rotated.png`, and `spark-mask-01.png`
- Geometry:
  - Each paper remains exactly 677 × 980.
  - Place lilac in the lower-left and sky in the upper-right.
  - Join their inner vertical edges at the composition center.
  - Use a 374-pixel vertical offset (`980 - 677`) so the combined exterior bounds are exactly 1354 × 1354.
  - Place the spark at the shared center so it knocks out both paper edges.
- No paper resampling or independent scaling is permitted.
- Candidate 05 outputs:
  - `02-final-master/master-assembly-02-no-knockout.png`
  - `02-final-master/spark-mask-02-fitted.png`
  - `02-final-master/candidate-05-master.png`
- Candidate 05 SHA-256: `108d73b50afcfb6fd18e4cff20599fcc3136f9b8c1dcc6bf4bd2fc8638ec3baf`
- Result: rejected but preserved
- Reason: the implementation accidentally used a 303-pixel Y offset. The resulting alpha bounds were 1354 × 1283 instead of the documented 1354 × 1354.

#### Raster master assembly 03

- Change from candidate 05: set only the lilac layer Y position to the documented 374 pixels (`1354 - 980`).
- All pixels, colors, paper dimensions, X positions, layer order, and spark mask remain unchanged.
- Expected alpha bounds: 1354 × 1354.
- Candidate output: `02-final-master/candidate-06-master.png`
- Candidate SHA-256: `acb73102e064f41bc10aca07d2b0dd017bba03efc1a83d52c01c3064b706b8c4`
- Result: rejected after user visual review; preserved only
- Rejection reason: the duplicated 677 × 980 paper construction made the papers excessively large relative to the center spark and distorted the original spark character. Passing mechanical equality and square-bound checks did not make the design faithful to the protected `grape-sky` reference.
- Validation:
  - both paper layers are exactly 677 × 980
  - sky alpha rotated back 180 degrees matches lilac alpha byte-for-byte
  - combined alpha bounds are exactly `(0, 0, 1354, 1354)`
  - center pixel alpha at `(677, 677)` is `0`
  - checkerboard preview: `05-validation/candidate-06-checker.png`
  - small-size preview: `05-validation/candidate-06-size-preview.png`

### Stage 2 — final raster master

Status: rejected; files preserved, not approved.

- Final master: `design/branding/grape-sky-lilac-raster/02-final-master/halopress-mark-master.png`
- Dimensions: 1354 × 1354 RGBA PNG
- SHA-256: `acb73102e064f41bc10aca07d2b0dd017bba03efc1a83d52c01c3064b706b8c4`
- Source candidate: `candidate-06-master.png`
- Recovery warning: do not restart later artwork from this file.
- No vector file exists or is used.

### Stage 3 — derived artwork

Status: invalidated because its source master was rejected.

All artwork in this stage uses only the approved raster master as the brand-mark input:

`02-final-master/halopress-mark-master.png`

The image generator creates backgrounds only. The approved mark is composited afterward without redrawing.

#### Artwork source A — light square background

- Mode: built-in `image_gen`
- Input: approved raster master
- Output path: `03-artwork-sources/background-light-01.png`
- Dimensions: 1254 × 1254 RGB PNG
- SHA-256: `1228c5b1d22937c9ab59b2072eb3c8eb79cb416de2be50c1bb2585c5311064f3`
- Prompt:

```text
Use case: stylized-concept
Asset type: square light-theme website brand-artwork background
Primary request: Create a premium abstract background inspired only by the light-lilac and sky-blue palette and concave paper curves in the supplied HaloPress raster master.
Input images: Image 1: approved raster master used only for palette and curve language
Scene: warm off-white square canvas with restrained translucent lilac and sky paper-like arcs framing the perimeter
Composition: preserve a calm central area for later placement of the exact raster master
Style: polished editorial gradient artwork, subtle paper atmosphere, modern publishing product
Constraints: background only; no logo; no spark; no icon; no text; no letters; no UI; no objects; no watermark
Avoid: coral, orange, gold, dark center, busy texture
```

#### Artwork source B — dark square background

- Mode: built-in `image_gen`
- Input: approved raster master
- Output path: `03-artwork-sources/background-dark-01.png`
- Dimensions: 1254 × 1254 RGB PNG
- SHA-256: `f6e38e642de85240483747b025a995d4802afd2486ecf68b26e42636981c1375`
- Prompt:

```text
Use case: stylized-concept
Asset type: square dark-theme website brand-artwork background
Primary request: Create a premium abstract background inspired only by the light-lilac and sky-blue palette and concave paper curves in the supplied HaloPress raster master.
Input images: Image 1: approved raster master used only for palette and curve language
Scene: deep midnight-grape square canvas with restrained luminous lilac and sky paper-like arcs framing the perimeter
Composition: preserve a calm central area for later placement of the exact raster master
Style: polished editorial gradient artwork, subtle dimensional paper atmosphere, modern publishing product
Constraints: background only; no logo; no spark; no icon; no text; no letters; no UI; no objects; no watermark
Avoid: coral, orange, gold, bright white center, busy texture
```

#### Artwork source C — social background

- Mode: built-in `image_gen`
- Input: approved raster master
- Output path: `03-artwork-sources/background-social-01.png`
- Dimensions: 1731 × 909 RGB PNG
- SHA-256: `ed0ec1abef2f18b58c4e57f1df7d7df673287ebfe1eb53dcbe99969b84732500`
- Prompt:

```text
Use case: ads-marketing
Asset type: 1.91:1 social sharing card background
Primary request: Create a premium wide HaloPress background inspired only by the light-lilac and sky-blue palette and concave paper curves in the supplied raster master.
Input images: Image 1: approved raster master used only for palette and curve language
Scene: deep midnight-grape wide canvas with soft lilac and sky paper arcs at the far edges
Composition: clean left area for exact logo placement and clean right area for wordmark and one short line of copy
Style: polished editorial brand background, subtle depth, high readability
Constraints: background only; no logo; no spark; no icon; no text; no letters; no UI; no watermark
Avoid: coral, orange, gold, centered focal object, busy texture
```

#### Artwork source D — installation journey

- Mode: built-in `image_gen` edit
- Input 1: preserved installation-journey raster composition
- Input 2: approved raster master
- Output path: `03-artwork-sources/install-journey-01.png`
- Dimensions: 2172 × 724 RGB PNG
- SHA-256: `e497257532d15341cdeac20b3746a56e73b63aaa2900625119e317c8aa51ecbf`
- Prompt:

```text
Use case: precise-object-edit
Asset type: wide HaloPress installation-journey illustration
Primary request: Recolor Image 1 using the exact light-lilac and sky-blue brand language from Image 2.
Input images: Image 1: edit target and composition invariant; Image 2: approved raster-master palette reference
Keep unchanged: all four stations, every object, object size, relative position, camera, 3:1 wide composition, connecting path, and clean 3D illustration style
Change only: platform and material palette to light lilac and grape; connection path and completion glow to luminous sky blue; documents remain soft white
Constraints: no logo; no spark; no text; no added or removed objects; no crop; no watermark
Avoid: coral, orange, gold, changed composition, extra stations
```

### Stage 3 result

Status: invalidated; generated files are preserved but are not approved brand assets.

Generated background sources remain unmodified in `03-artwork-sources/`. The approved raster master was composited afterward without redrawing, vectorizing, or applying a shadow that could contaminate the transparent spark.

## 7. Previous deliverables — unapproved

All production-ready files are preserved first in:

`design/branding/grape-sky-lilac-raster/04-deliverables/`

| Deliverable | Dimensions | SHA-256 |
| --- | --- | --- |
| `halopress-mark-master.png` | 1354 × 1354 RGBA | `acb73102e064f41bc10aca07d2b0dd017bba03efc1a83d52c01c3064b706b8c4` |
| `halopress-mark-512.png` | 512 × 512 RGBA | `aed0e00ace8490b44de77c478462936b92e564244b6b5fdf2710cf4e9abcdee5` |
| `halopress-mark-256.png` | 256 × 256 RGBA | `c8beb0141e5f0f49d6fe93a44c5b277fff0a33aee3e13de381a627839f6aea45` |
| `halopress-mark-180.png` | 180 × 180 RGBA | `918e167ac376a06166e17d19007739567a3e8995e185d97011a37d4c02ecbe7d` |
| `halopress-mark-64.png` | 64 × 64 RGBA | `b090306d5c0dee5006bb4d8837c21c5bb2244c7362d269fb286b85433fada27f` |
| `favicon.ico` | 16/32/48/64 ICO | `638069712be0b6c86f75661e95def9303e5a64f8c4e701fd572fdb4efac7ded8` |
| `halopress-brand-artwork-light.png` | 1254 × 1254 RGB | `191cec7e4b8917a606dfbc948e5897681c9e69625c70d0aadee3b2589e28b941` |
| `halopress-brand-artwork-dark.png` | 1254 × 1254 RGB | `0fe1ab699c30b0c1a2bce7e43851068c67bdf492771b7602e7f9934565ec16a3` |
| `halopress-social-card.png` | 1200 × 630 RGB | `a23e259c154377902d0a331dd603e615072ca2dcab070598e4121d56f8678bc6` |
| `halopress-install-wizard-journey.png` | 2172 × 724 RGB | `f498c59f37686d2fac36ebc823fc865fd544a85c8dad3c441a800894cad2dc44` |

Additional favicon PNG sizes (`16`, `32`, and `48`) remain in the same directory.

## 8. Pre-final public backup

Before copying the deliverables into `public/`, the previous working state was preserved in:

`design/branding/grape-sky-lilac-raster/00-pre-final-public-backup/`

This directory must not be deleted. It contains the previously active favicon, mark, artwork, social card, and installation image.

## 9. Previous public mapping — unapproved

| Public path | Deliverable source |
| --- | --- |
| `public/favicon.ico` | `04-deliverables/favicon.ico` |
| `public/favicon.png` | `04-deliverables/halopress-mark-64.png` |
| `public/apple-touch-icon.png` | `04-deliverables/halopress-mark-180.png` |
| `public/branding/halopress-mark-transparent.png` | `04-deliverables/halopress-mark-master.png` |
| `public/branding/halopress-mark-256.png` | `04-deliverables/halopress-mark-256.png` |
| `public/branding/halopress-brand-artwork-light.png` | matching deliverable |
| `public/branding/halopress-brand-artwork-dark.png` | matching deliverable |
| `public/branding/halopress-social-card.png` | matching deliverable |
| `public/branding/halopress-install-wizard-journey.png` | matching deliverable |

## 10. Historical validation of the rejected master

- Master SHA-256 matches the accepted candidate.
- Paper alpha equality after reversing the sky layer's 180-degree rotation: pass.
- Master alpha bounds: `(0, 0, 1354, 1354)`.
- Master center alpha: `0`.
- Favicon PNG alpha bounds fill each square canvas at 16, 32, 48, 64, 180, 256, and 512 pixels.
- Favicon center alpha:
  - 16px: `90` due to one-pixel antialiasing after reduction
  - 32px: `0`
  - 48px: `0`
  - 64px: `1`
  - 180px: `1`
  - 256px: `1`
  - 512px: `0`
- Contact sheet: `05-validation/brand-family-contact-sheet.png`
- Candidate checkerboard: `05-validation/candidate-06-checker.png`
- Browser-size preview: `05-validation/candidate-06-size-preview.png`

### Stage 4 — delivery and validation

Status: invalidated by the later visual rejection.

- Active public files match their `04-deliverables/` sources byte-for-byte.
- `pnpm test tests/site-presentation-settings.test.ts`: pass, 10 tests.
- `pnpm exec eslint shared/site-presentation.ts tests/site-presentation-settings.test.ts`: pass.
- Default social image fallback: `/branding/halopress-social-card.png`.

### Stage 5 — original-design reset

Status: approved by user on 2026-07-23.

The previous square-bound reconstruction was abandoned. This stage returns to the protected right-hand `grape-sky` design and locks its original page-to-spark relationship, tall mark proportion, curve placement, and surrounding margin.

All files are preserved in:

`design/branding/grape-sky-lilac-raster/06-original-redesign/`

#### Candidate 07 — original proportions and transparent knockout

- Mode: built-in `image_gen` precise edit
- Input: protected `design/branding/halopress-theme-grape-sky.png`
- Chroma output: `candidate-07-original-proportions-chroma.png`
- Transparent output: `candidate-07-original-proportions.png`
- Comparison: `candidate-07-comparison.png`
- Dimensions: 1254 × 1254 RGBA PNG
- Transparent SHA-256: `e90ff25a278e3f5f758aed39bfadaa7f3719f56e25c664ab35a48e0c12410d90`
- Result: superseded by candidate 08 after user color feedback; geometry retained
- Geometry rule: no page or spark scaling, stretching, rotation, or independent reconstruction after generation
- Background removal: raster chroma-to-alpha only; no vector path was created
- Recovery script: `prepare-candidate-07.mjs`
- Prompt:

```text
Use case: precise-object-edit. Create one square raster master candidate from the RIGHT-HAND grape-sky mark in the supplied reference. Preserve the right-hand mark's geometry faithfully: the exact two page silhouettes, their original relative size, their original overlap and offset, their original curved top/bottom edges, and the original centered eight-point spark proportions. Do not enlarge the papers relative to the spark. Do not flatten, stretch, rotate, redraw, or exaggerate the spark. Keep the pale lilac lower-left paper and luminous sky-blue upper-right paper. Remove the left-hand logo and all split-screen presentation. Place only the original-size right-hand mark centered on a square, perfectly uniform #00ff00 chroma background, retaining generous surrounding margin comparable to the reference. Render the central eight-point spark in exactly #00ff00 so it becomes a knockout with the background. No text, no shadows, no border, no extra elements, no new gradients, no vector-style reconstruction, no changes to paper proportions.
```

#### Candidate 08 — color tuning only

- Input: `candidate-07-original-proportions.png`
- Output: `candidate-08-color-tuned.png`
- Comparison: `candidate-08-comparison.png`
- Dimensions: 1254 × 1254 RGBA PNG
- SHA-256: `5b948e437a7696fe68e20dcd761b9b9f0e4850b97de5d372eaf36113f837ad13e`
- Geometry and alpha: inherited unchanged from candidate 07
- Sky adjustment: HSL saturation `× 1.28 + 0.04`; HSL lightness unchanged
- Lilac adjustment: HSL lightness `− 0.055`; HSL saturation unchanged
- Edge cleanup: remove residual green spill only on partially transparent pixels
- Recovery script: `prepare-candidate-08.mjs`
- Status: superseded after user review
- Rejection reason: the narrow center channel made the two papers appear attached, and the lilac needed slightly greater depth.

#### Candidate 09 — uniform center channel and deeper lilac

- Mode: built-in `image_gen` precise edit
- Input: `candidate-08-color-tuned.png`
- Chroma output: `candidate-09-uniform-gap-chroma.png`
- Transparent output: `candidate-09-uniform-gap.png`
- Comparison: `candidate-09-comparison.png`
- Dimensions: 1254 × 1254 RGBA PNG
- Transparent SHA-256: `c5561798599b1a7357d40bfcd6d8db20ea0d4cbeca2dfcda63f49119a8ddc753`
- Geometry changes: only the inward-facing center curves were separated; exterior page silhouettes and the eight-point knockout were locked
- Color change: lilac lightness lowered slightly; sky color kept unchanged
- Background removal: raster chroma-to-alpha only; no vector path was created
- Recovery command: run `prepare-candidate-07.mjs` with `CANDIDATE_SOURCE`, `CANDIDATE_OUTPUT`, and `CANDIDATE_COMPARISON` set to the candidate 09 paths
- Validation:
  - canvas: 1254 × 1254
  - alpha bounds: `(319, 186, 908, 954)`
  - all four corner alpha values: `0`
  - upper center channel outside the spark: 10 pixels at rows 430, 440, and 450
  - lower center channel outside the spark: 10 pixels at rows 750, 760, 770, and 780
- Status: approved production raster master
- Prompt:

```text
Use case: precise-object-edit. Image 1 is the edit target and geometry invariant. Create candidate 09 on a perfectly uniform flat #00ff00 chroma-key square background. Change only two things: (1) between the two papers' inward-facing curved edges, create one continuous, visually uniform narrow #00ff00 gap so the lilac and sky papers never appear attached; keep this channel approximately 12 pixels wide at the 1254px canvas scale everywhere outside the existing central eight-point knockout. The gap should flow cleanly into the central knockout, with parallel smooth facing curves and no pinched or touching points. (2) make only the lilac paper slightly deeper by lowering its lightness a small amount, about 4 percentage points; keep its hue and saturation character. Keep unchanged: exact 1254×1254 composition, generous margin, both papers' exterior silhouettes, page size and position, original page-to-spark ratio, exact unwarped eight-point knockout size and point lengths, sky paper hue/saturation/lightness, gradients, raster finish. The center spark and all background areas must be exactly #00ff00. No text, shadow, border, new shapes, extra spikes, white or black fill, resizing, stretching, rotation, vector reconstruction, or alterations to the outer edges.
```

### Stage 6 — approved flat derivative family

Status: complete. The generated square light/dark backgrounds were later superseded by the selected export backgrounds in Stage 7; their source and outputs remain preserved.

Approved master:

`design/branding/grape-sky-lilac-raster/02-final-master/halopress-mark-master-v2.png`

- Dimensions: 1254 × 1254 RGBA PNG
- SHA-256: `c5561798599b1a7357d40bfcd6d8db20ea0d4cbeca2dfcda63f49119a8ddc753`
- Source: byte-identical copy of approved candidate 09
- Vectorization: none

All stage files are isolated under:

`design/branding/grape-sky-lilac-raster/07-approved-derived-artwork/`

The directory structure is:

1. `00-public-backup/` — public files immediately before candidate 09 delivery
2. `01-background-sources/` — untouched generated flat backgrounds
3. `02-deliverables/` — production files derived from the approved raster master
4. `03-validation/` — contact sheets, size previews, and preserved rejected layouts

#### Flat background A — light artwork

- Mode: built-in `image_gen`
- Output: `01-background-sources/background-light-02-flat.png`
- Dimensions: 1254 × 1254 RGB PNG
- SHA-256: `37dc1481b2fe2e7fa14790ecb7453b91fb09195088dcea6e8a9864edbfd3b523`
- Prompt:

```text
Use case: stylized-concept. Asset type: square light-theme HaloPress brand artwork background. Image 1 is a palette and curve-language reference only; do not reproduce or redraw its logo. Create a polished flat editorial composition on a warm off-white square canvas. Use only broad two-dimensional paper-color fields in the approved deeper lilac and luminous sky-blue palette, with one or two oversized smooth concave page curves entering from the outer corners and a calm open center reserved for later placement of the exact raster mark. Style: modern publishing identity, crisp flat color planes, restrained subtle color transitions only, generous negative space. Constraints: background only; no logo, no star or spark, no text, no letters, no icons, no objects, no shadows, no bevels, no paper texture, no lighting effects, no 3D, no photorealism, no watermark. Avoid: coral, orange, gold, busy layering, central focal symbol.
```

#### Flat background B — dark artwork

- Mode: built-in `image_gen`
- Output: `01-background-sources/background-dark-02-flat.png`
- Dimensions: 1254 × 1254 RGB PNG
- SHA-256: `343932c061d7b537d1d6b43283b310a7dcde73ca7eabeb698f4f0100fc65789e`
- Prompt:

```text
Use case: stylized-concept. Asset type: square dark-theme HaloPress brand artwork background. Image 1 is a palette and curve-language reference only; do not reproduce or redraw its logo. Create a polished flat editorial composition on a deep midnight-grape square canvas. Use only broad two-dimensional color fields in the approved deeper lilac and luminous sky-blue palette, with one or two oversized smooth concave page curves entering from opposite outer corners and a calm open center reserved for later placement of the exact raster mark. Maintain strong separation from the center mark. Style: modern publishing identity, crisp flat color planes, restrained subtle color transitions only, generous negative space. Constraints: background only; no logo, no star or spark, no text, no letters, no icons, no objects, no shadows, no glow, no bevels, no paper texture, no lighting effects, no 3D, no photorealism, no watermark. Avoid: coral, orange, gold, black central void, busy layering, central focal symbol.
```

#### Flat background C — social card

- Mode: built-in `image_gen`
- Output: `01-background-sources/background-social-02-flat.png`
- Dimensions: 1733 × 907 RGB PNG
- SHA-256: `5e2dbbdece3831bf508e5746a7333d298f8cdf0a276fe2caff14f7f651eb2606`
- Prompt:

```text
Use case: ads-marketing. Asset type: 1.91:1 HaloPress social sharing card background. Image 1 is a palette and curve-language reference only; do not reproduce or redraw its logo. Create a wide, polished flat editorial background on deep midnight grape. Use one broad deeper-lilac paper curve entering from the lower-left edge and one luminous sky-blue paper curve entering from the upper-right edge. Keep a clean dark central band, with clear space for an exact raster logo on the left and a short wordmark plus one subtitle on the right. The composition should feel like a contemporary publishing cover card. Style: crisp two-dimensional color planes, very restrained subtle gradients, no material depth. Constraints: background only; no logo, no star or spark, no text, no letters, no icons, no shadows, no glow, no bevels, no texture, no 3D, no photorealism, no watermark. Avoid: coral, orange, gold, busy decoration, centered object.
```

#### Flat background D — wizard header

- Mode: built-in `image_gen`
- Output: `01-background-sources/background-wizard-02-flat.png`
- Dimensions: 2172 × 724 RGB PNG
- SHA-256: `f30ca6f793bc07eb8842d0bad4b6947df8391a982c3d38976805530742ed4e88`
- Direction: social-card-like 3:1 editorial header; the previous 3D pedestal journey, neon path, and isometric objects are intentionally removed
- Prompt:

```text
Use case: stylized-concept. Asset type: 3:1 HaloPress first-run wizard header background with the visual feel of a premium social card. Image 1 is a palette and curve-language reference only; do not reproduce or redraw its logo. Create a very wide flat editorial banner on deep midnight grape. Use a deeper-lilac paper field sweeping in from the lower-left and a luminous sky-blue paper field sweeping in from the upper-right, leaving a generous dark center. Suggest publishing and setup only through a few clean flat page-card silhouettes progressing horizontally in the middle distance; use simple rectangles with one curved page corner, no symbols and no text. Reserve the upper-left area for the application's overlaid logo controls and reserve the right-center area for later placement of the exact raster mark. Style: contemporary publishing cover card, crisp two-dimensional shapes, restrained subtle gradients, no material depth. Constraints: background only; no logo, no star or spark, no words, no letters, no UI screenshots, no device, no database cylinder, no character, no shadows, no glow, no bevels, no 3D, no photorealism, no watermark. Avoid: isometric objects, neon connector line, four pedestal stations, coral, orange, gold, busy detail.
```

#### Raster-only derivation

- Build script: `07-approved-derived-artwork/build-derived-artwork-v2.mjs`
- Mark source: approved master v2 only
- Background source handling: generated files remain untouched
- Mark handling: alpha-bounds crop plus uniform Lanczos resampling only; no path tracing, redrawing, independent paper transform, or vector conversion
- Social text: rasterized after background generation; the mark is still composited from the approved PNG
- Favicon fill: the mark occupies approximately 98% of each square's height while preserving its intrinsic aspect ratio
- Wizard header: exact 3:1 output, no code dimension change required
- Rejected first social/wizard placements are preserved in `03-validation/`

#### Approved deliverables

| Deliverable | Dimensions | SHA-256 |
| --- | --- | --- |
| `favicon.ico` | 16/32/48/64 ICO | `f2000b16ccbc319073c54b51f7b0735bb289b71bc0128d3ba764f52c28c99689` |
| `halopress-mark-master-v2.png` | 1254 × 1254 RGBA | `c5561798599b1a7357d40bfcd6d8db20ea0d4cbeca2dfcda63f49119a8ddc753` |
| `halopress-mark-transparent.png` | 1254 × 1254 RGBA | `a79df5f3d66cf363db58f7db8a281c1bc47c8214c4d998fbaf9e63a697c7a730` |
| `halopress-mark-512.png` | 512 × 512 RGBA | `8611c335b3c872ad4e83f153bc4cac5807b80ca1bc7da60d31e8ed0561078df3` |
| `halopress-mark-256.png` | 256 × 256 RGBA | `38f996860083eb14cd065a721ef8901f4d4e08c2e54304157a07a053f7e5604e` |
| `halopress-mark-180.png` | 180 × 180 RGBA | `ea9138066a82406af6ea3620b1d4b882c55689900e3a7d74f92e45691c3570c8` |
| `halopress-mark-64.png` | 64 × 64 RGBA | `f077e8a99db0cfd290700d1c655c1be98ed56a6adbae78a63edcd7f719a1d40c` |
| `halopress-brand-artwork-light.png` | 1254 × 1254 RGB | `43de97b7da3cf09b5f767be7812a10af04b1e9abd2b1589a3d7fdb27f44c20cd` |
| `halopress-brand-artwork-dark.png` | 1254 × 1254 RGB | `ed7de92adac15de772bdf7a8726da9d16ec796fd77c5a6388773b5c32e5473fe` |
| `halopress-social-card.png` | 1200 × 630 RGB | `667987d6a3216351728aac7bbd13c9800416bbed19af9263f1d6f7b39188e8b1` |
| `halopress-install-wizard-journey.png` | 2172 × 724 RGB | `bbecbcf6a658d12c2fa7d4dea9f4b419931419b1822828578c538edb99724eed` |

#### Active public mapping

| Public path | Approved source |
| --- | --- |
| `public/favicon.ico` | `02-deliverables/favicon.ico` |
| `public/favicon.png` | `02-deliverables/halopress-mark-64.png` |
| `public/apple-touch-icon.png` | `02-deliverables/halopress-mark-180.png` |
| `public/branding/halopress-mark-transparent.png` | matching approved deliverable |
| `public/branding/halopress-mark-256.png` | matching approved deliverable |
| `public/branding/halopress-mark-light.png` | matching approved deliverable |
| `public/branding/halopress-mark-dark.png` | matching approved deliverable |
| `public/branding/halopress-mark-light-256.png` | matching approved deliverable |
| `public/branding/halopress-mark-dark-256.png` | matching approved deliverable |
| `public/branding/halopress-brand-artwork-light.png` | matching approved deliverable |
| `public/branding/halopress-brand-artwork-dark.png` | matching approved deliverable |
| `public/branding/halopress-social-card.png` | matching approved deliverable |
| `public/branding/halopress-install-wizard-journey.png` | matching approved deliverable |

#### Validation

- Public files match approved deliverables byte-for-byte.
- Center alpha is `0` at 16, 48, 64, 180, 256, and 512 pixels; it is `5` at 32 pixels due to antialiasing.
- Visible favicon height coverage:
  - 16px: 100%
  - 32px: 96.9%
  - 48px: 97.9%
  - 64px: 98.4%
  - 180px: 97.8%
  - 256px: 98.0%
  - 512px: 97.7%
- Light/dark small-size preview: `03-validation/mark-sizes-light-dark.png`
- Full family preview: `03-validation/brand-family-v2-contact-sheet.png`
- `node --check` passes for all three raster recovery/build scripts.
- `pnpm test tests/site-presentation-settings.test.ts tests/onboarding.test.ts`: pass, 23 tests.

### Stage 7 — restore selected export backgrounds

Status: complete.

The light and dark branding backgrounds are not regenerated. The user-selected existing exports are treated as read-only composition inputs:

| Selected source | Dimensions | SHA-256 |
| --- | --- | --- |
| `design/branding/exports/brand-background-light.png` | 1254 × 1254 RGB | `ec11c728e06045e225e7302a3c51346b668f205b4e6e97713d09e6372b2f9784` |
| `design/branding/exports/brand-background-dark.png` | 1254 × 1254 RGB | `e23bd119277479d1c81341a827d3a3bcc3d5da6d8430554ce74da70622acf69c` |

Only the two square branding artworks changed in this stage. The approved candidate 09 master, favicon family, social card, and wizard header remain unchanged.

#### Composition

- Build script: `07-approved-derived-artwork/build-derived-artwork-v2.mjs`
- Mark input: `02-final-master/halopress-mark-master-v2.png`
- Mark transform: alpha-bounds crop followed by uniform Lanczos resize to 700 pixels high
- Placement: centered on the unchanged 1254 × 1254 selected background
- Knockout: inherited from the approved raster master and reveals the selected background
- Image generation: none
- Vectorization: none

#### Updated square artwork

| Deliverable | Dimensions | SHA-256 |
| --- | --- | --- |
| `halopress-brand-artwork-light.png` | 1254 × 1254 RGB | `77ec480be0ccc925f162ead2384d2a5200cf584e11dfb1585bb047f944b273b3` |
| `halopress-brand-artwork-dark.png` | 1254 × 1254 RGB | `a3d7b4950e4be3390f0ea0865dbbef96893a87d714a8d9efb6c263b82aa0e120` |

The previous generated-background composites remain preserved at:

- `03-validation/superseded-brand-artwork-light-flat-generated.png`
- `03-validation/superseded-brand-artwork-dark-flat-generated.png`
- `03-validation/superseded-brand-family-generated-backgrounds.png`

Validation:

- `public/branding/halopress-brand-artwork-light.png` matches the updated deliverable byte-for-byte.
- `public/branding/halopress-brand-artwork-dark.png` matches the updated deliverable byte-for-byte.
- Updated family preview: `03-validation/brand-family-v2-contact-sheet.png`

### Stage 8 — clean social and wizard curve boundaries

Status: complete.

The generated wide backgrounds are no longer active. Both the social card and wizard header now use deterministic crops of the selected read-only dark export:

`design/branding/exports/brand-background-dark.png`

No background generation or vectorization occurs in this stage.

#### Social card

- Source crop: `(0, 0, 1100, 578)`
- Output: 1200 × 630 RGB PNG
- Resize: uniform 1.091× Lanczos scaling
- Mark: approved raster master cropped to alpha bounds, 340 pixels high
- Mark placement: `(220, 70)`
- Title placement: `(520, 190)`, 70-pixel Arial/Helvetica raster text
- Subtitle: 27-pixel raster text
- Composition result:
  - the mark's lilac paper remains entirely in the dark center
  - a clear dark gap separates it from the lower-left lilac background
  - the title and subtitle remain left of the right-hand sky curve
- SHA-256: `942b0830299bba1418147b3650136c836f80751ffa85a7f07bb59d1505d26d0b`

#### Wizard header

- Source crop: `(0, 0, 1254, 418)`
- Output: 2172 × 724 RGB PNG
- Resize: uniform 1.732× Lanczos scaling
- Mark: approved raster master cropped to alpha bounds, 380 pixels high
- Mark placement: `(1160, 210)`
- Composition result:
  - the upper-left UI overlay area remains clear
  - the mark stays on the dark center
  - a visible dark gap separates the mark's sky paper from the right-hand sky curve
- SHA-256: `0b62df9bc98d347b03143f5e04508bcbf0ddc4ce8d53af875aeda4394bb0f7cf`

Preserved prior layouts:

- `03-validation/superseded-social-generated-background.png`
- `03-validation/superseded-wizard-generated-background.png`
- `03-validation/superseded-social-selected-background-layout-01.png`
- `03-validation/superseded-social-selected-background-layout-02.png`
- `03-validation/superseded-brand-family-before-wide-background-cleanup.png`
- `03-validation/superseded-brand-family-social-text-overlap.png`

Validation:

- `public/branding/halopress-social-card.png` matches the current deliverable byte-for-byte.
- `public/branding/halopress-install-wizard-journey.png` matches the current deliverable byte-for-byte.
- Output dimensions remain compatible with existing application markup.
- `node --check 07-approved-derived-artwork/build-derived-artwork-v2.mjs`: pass.
- Current family preview: `03-validation/brand-family-v2-contact-sheet.png`

### Stage 9 — freeform wizard header

Status: complete.

The wizard header keeps the approved raster logo but moves away from the rigid social-card composition. Only the wizard header changes in this stage; the social card and all other assets remain unchanged.

#### Freeform background

- Mode: built-in `image_gen`
- References:
  - `design/branding/exports/brand-background-dark.png` for preferred mood and curve language
  - approved candidate 09 for palette reference only
- Preserved output: `01-background-sources/background-wizard-03-freeform.png`
- Dimensions: 2172 × 724 RGB PNG
- SHA-256: `9d869ce6a153aa119ba136257720a2fb628f5cafc14c37bb428c9f11dbacb81b`
- Prompt:

```text
Use case: stylized-concept. Asset type: 3:1 HaloPress first-run wizard header background. Image 1 is the preferred dark background mood and paper-curve reference. Image 2 is the approved palette and logo-shape reference only; do not reproduce or redraw its logo. Create a more expressive, less rigid editorial banner on deep midnight grape. Let broad translucent lilac and luminous sky-blue paper ribbons sweep asymmetrically across the canvas with varied scale, off-axis arcs, and generous dark breathing space, as if loose pages are opening and drifting through a publishing portal. The movement should feel fluid and optimistic rather than arranged like a social card, grid, diagram, or sequence of boxes. Keep the upper-left corner calm for existing application controls and leave one naturally framed dark pocket around the center-right for later placement of the exact raster logo. Use clean continuous curve boundaries and restrained soft gradients. Constraints: background only; no logo, no star or spark, no words, no letters, no UI screenshot, no card row, no icons, no 3D objects, no pedestals, no neon connector, no shadows, no bevels, no photorealism, no watermark. Avoid: symmetry, rigid left-logo/right-copy composition, straight panel divisions, jagged edges, coral, orange, gold.
```

#### Final wizard composition

- Background: preserved freeform source above, unchanged
- Logo source: approved `halopress-mark-master-v2.png`
- Logo transform: alpha-bounds crop and uniform Lanczos resize to 380 pixels high
- Logo placement: `(1100, 270)`
- Logo rotation or deformation: none
- Output: `02-deliverables/halopress-install-wizard-journey.png`
- Dimensions: 2172 × 724 RGB PNG
- SHA-256: `27566c8392103815d2185392b5656be4b2e89b59a57f150e20707c9d8c1b3302`
- Previous selected-background header: `03-validation/superseded-wizard-selected-background-rigid.png`

Validation:

- Upper-left application-control area remains dark and unobstructed.
- The approved logo sits in a naturally framed dark pocket between the two asymmetrical paper flows.
- The logo does not touch either the lilac or sky background ribbon.
- `public/branding/halopress-install-wizard-journey.png` matches the deliverable byte-for-byte.
- Output dimensions remain compatible with existing 3:1 application markup.
- `node --check 07-approved-derived-artwork/build-derived-artwork-v2.mjs`: pass.

### Stage 10 — application integration

Status: complete.

No image generation, raster transformation, or vectorization occurs in this stage. The approved public files are consumed without modification.

#### Integration map

| Surface | Application |
| --- | --- |
| Browser tab and saved shortcut | Public layouts publish the configured favicon family; `useHaloPressBrandHead.ts` publishes the approved defaults for Blank and Desk layouts without duplicating public head links |
| Public-site social metadata | `shared/site-presentation.ts` defaults `socialImageUrl` to `public/branding/halopress-social-card.png`; both built-in and persisted public layout renderers consume that presentation value |
| README | The opening picture switches between `halopress-brand-artwork-light.png` and `halopress-brand-artwork-dark.png` using `prefers-color-scheme` |
| Public home page | `AppBrandArtwork.vue` switches between the selected light/dark square artwork and is displayed by the built-in HaloPress hero |
| Public authentication pages | Login and signup card headers display the approved raster mark through `AppLogo.vue` |
| Desk shell | The existing sidebar wordmark consumes the approved raster mark; the Desk title is branded as `HaloPress Desk` |
| Desk dashboard | A responsive brand-artwork banner uses the selected light/dark square artwork without changing the existing dashboard card structure |
| Installation wizard | The existing 3:1 header continues to use `halopress-install-wizard-journey.png` |

#### Recovery notes

- Application integration is code-only. Rebuilding the UI does not require rebuilding any artwork.
- The light/dark switch is defined in `app/components/AppBrandArtwork.vue`.
- Default Blank/Desk favicon links are defined in `app/composables/useHaloPressBrandHead.ts`; public favicon links remain owned by the public layout renderers.
- The public social-card fallback is defined in `shared/site-presentation.ts`.
- The original and intermediate design files remain untouched under `design/branding/`.
- Regression coverage is recorded in `tests/brand-application.test.ts`.

#### Validation

- `pnpm test`: pass, 106 test files and 786 tests.
- `pnpm lint`: pass.
- `pnpm typecheck`: pass.
- `pnpm build`: pass for the Cloudflare module production preset.
- Local runtime:
  - `/`, `/favicon.ico`, `/favicon.png`, both square artworks, the social card, and the wizard header return `200`.
  - `/_desk` follows the expected authentication redirect.
  - Public SSR contains one link each for `favicon.ico`, `favicon.png`, and `apple-touch-icon.png`.
  - Public SSR uses `halopress-social-card.png` for both Open Graph and Twitter image metadata.
- Public favicon, social-card, and wizard-header SHA-256 values still match the approved deliverables recorded in Stages 6 and 9.
