# Public membership and authentication

HaloPress keeps public membership separate from Desk authorization. Installation-created users are staff accounts; accounts created through public registration or Google provisioning are marked as public members. Only active staff administrators may enter Desk or use administrator APIs. Public members receive published delivery behavior even while signed in.

## Admission modes

Membership is `disabled` by default. Administrators can select one of four server-enforced modes in **Desk → Settings → Membership**:

- `disabled`: no new password or Google accounts are provisioned.
- `open`: a visitor receives an active member account immediately.
- `invite`: a visitor needs a single-use, expiring code bound to the canonical email. Google may consume an outstanding invitation only after Google verifies that email.
- `approval`: registration creates a `pending` account. An administrator must activate it in **Desk → Users** before sign-in succeeds.

The configured default role must exist and cannot be `admin` or `anonymous`. The account remains a public member regardless of role, so role changes cannot grant Desk access accidentally.

Password registration is limited to five attempts per 15-minute window for both hashed client-address and canonical-email buckets. Counters are stored in D1/SQLite so Worker restarts do not reset the limit.

## Canonical email and migration safety

All new email writes are trimmed and lowercased. Migration `0006_add_public_member_identities` checks normalized legacy emails in a temporary unique table before changing stored values or creating the unique user-email index. If case variants or duplicates collide, migration stops instead of choosing an account automatically. Resolve those records explicitly, then rerun the migration.

## Google identities and linking

Google identities are keyed by Google’s stable OpenID Connect subject, not mutable email. HaloPress stores the verified-email state observed during linking and never downgrades an already verified identity.

A Google account is never silently attached to an existing password account because its email matches. The signed-in user must open **Sign-in methods**, re-enter the current password, and complete Google OAuth using a short-lived HTTP-only link intent. The verified Google email must match the reauthenticated account at first link. After linking, the stable subject owns future sign-ins even if Google later changes the displayed email.

## Current recovery and verification limits

HaloPress does not yet send verification or password-recovery email. Password registrations therefore have no verified-email timestamp, and a forgotten password requires administrator assistance. Google-provisioned accounts require Google’s verified-email claim, but this does not add a HaloPress mail channel.

Keep open registration disabled unless the site accepts the email-squatting, recovery, and abuse tradeoffs. Invitation or approval mode reduces exposure but does not replace recovery or verification delivery.
