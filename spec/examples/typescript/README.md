# TypeScript examples

The examples in `spec/examples/` default to Python. Day-one languages are Python, Go, and TypeScript. If your project uses TypeScript, use the files in this `typescript/` folder instead of their Python counterparts in the root. For example, use `audiences.ts` instead of `../audiences.py`. Go examples live in `../go/`.

The message YAML in `../messages/` is shared by every language. In your app, messages live at `plgkit/nudges/messages/`.

In your own app, the audience file lives at `plgkit/nudges/audiences.ts`. Nudges config lives at `plgkit/nudges/config.yml` and is Nudges-only.
