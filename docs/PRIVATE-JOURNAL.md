# Existing-member journal access

Enabled 2026-10-15 at the user's request. Applies only to the Trading Journal; shared Supabase Auth signup and advisor tables remain unchanged.

The migration takes a one-time snapshot of the five existing Auth accounts into journal_members. Future accounts are never automatically added. Clients can read only their own membership and cannot insert/update/delete memberships. journal_access_allowed checks auth.uid() on the server, not editable metadata.

The journal checks membership before legal acceptance, data loads and screener session authorization. A denied or failed request leaves the app inert and the sign-in overlay visible. It does not call shared Auth signOut, so another application's session is not intentionally revoked. Journal email signup is blocked; Google remains available for approved existing accounts. Landing calls to action point to member login.

Restrictive policies on 11 journal-specific tables compose with existing owner policies. A trigger also prevents authenticated non-member writes through security-definer mutations on those tables. Shared user_settings, advisor/budget tables and global Auth configuration are not changed. Service/background database operations retain their existing behavior. This is a journal admission restriction, not a claim that every shared market-data endpoint is private or that the public landing page is inaccessible.

Verification: tests/private-journal.sql runs rollback-only checks of membership, self-admission permissions, journal reads and a security-definer legal write. An additional rollback-only auth.users insert verified that future shared Auth accounts can be created but are not admitted. Browser tests use mocked accounts. No real trading account was used for login testing.

To admit a future journal member, a trusted administrator must explicitly insert that existing Auth user ID into journal_members through the database administration tool. No browser enrollment endpoint exists. Do not disable Auth signup globally: that would affect the advisor platform. To reopen the journal, remove the frontend signup restriction and revise this admission mechanism intentionally; changing marketing copy alone does not reopen data access.

This restriction does not settle market-data licenses or provide immunity from legal claims. No trading data or existing account was deleted.
