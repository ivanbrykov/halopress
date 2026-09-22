# Editorial safety

HaloPress keeps editing, publication, archival, and deletion as separate server-enforced capabilities. Schema administrators always retain every capability. Other roles may receive `Write`, `Publish`, `Archive`, and `Delete` independently; a writer without `Publish` can create and update drafts but cannot change anonymous delivery.

## Publication transitions

Content and standalone pages use explicit commands rather than accepting arbitrary status writes.

| Current state | Save | Publish | Archive / unpublish | Delete | Recover |
| --- | --- | --- | --- | --- | --- |
| Draft | Draft | Published | Archived | Deleted | — |
| Published | Draft working copy | Published | Archived | Deleted | — |
| Archived | Archived working copy | Published | Archived | Deleted | — |
| Deleted | — | — | — | — | Draft |

Publishing creates a new immutable public revision. Saving a working draft never mutates the revision used for anonymous delivery. Archiving or deleting removes public projections and pointers transactionally. Recovery always returns a deleted document as a private draft; publishing it again is a separate decision.

## Concurrency and history

Every content item, standalone page, and schema draft has an integer revision token. Existing-document mutations must send the token returned by the latest read. A stale token returns `409 Conflict` with the current revision and last-update metadata, and no working or published projection is changed.

Meaningful saves and transitions append an immutable snapshot with action, state, actor, and time. Restoring a snapshot creates a new working revision; it never rewrites history or silently republishes a document. Content restore rebuilds the working listing, search, reference, and asset projections in the same transaction. Page restore rebuilds working asset references.

HaloPress retains the latest 100 ordinary `save` snapshots per document. Transition snapshots (`publish`, `archive`, `delete`, `recover`, `restore`, and `migrate`) are preserved beyond that window so the safety-critical state changes remain inspectable. Published delivery snapshots use the separate publication-revision store and are not pruned by this policy.
