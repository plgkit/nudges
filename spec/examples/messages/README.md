# Messages

Name each message `YYYYMMDDHHMMSS-<slug>.yml`. The timestamp is UTC, in the style of a Rails migration. The slug is lowercase letters, numbers, and dashes. The filename without `.yml` is the message ID. The timestamp prefix makes reuse of a removed message's ID practically impossible.

Never rename or reuse an ID. Renaming makes a new message and resets dismissals and impressions.

CI should fail on duplicate IDs or on names without the prefix.

In your app, messages live at `plgkit/nudges/messages/` and audiences at `plgkit/nudges/audiences.ts` (Python: `plgkit/nudges/audiences.py`).

```
plgkit/nudges/
  messages/
  audiences.py
  config.yml
```

Use `audiences.ts` instead of `audiences.py` in a TypeScript app. `config.yml` is Nudges-only. A shared `plgkit/config.yml` is only for cross-product settings, such as a hosted API key, and is not included here. `plgkit/` is the umbrella folder. Other PLGKit products get sibling folders next to `nudges/`. Personas will live in `plgkit/personas/`.
