# plgkit

Nudges are messages your app shows in named slots. Events live in an append-only table for impressions, clicks, and dismisses.

**`plgkit undismiss <nudge_id> --user <user_id>`** is a dev-only CLI: it deletes dismiss rows for that user and nudge so you can see the message again locally. It is not for production.
