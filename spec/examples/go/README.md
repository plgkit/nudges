# Go examples

The examples in `spec/examples/` default to Python. Day-one languages are Python, Go, and TypeScript. If your project uses Go, use the files in this `go/` folder instead of their Python counterparts in the root. For example, use `audiences.go` instead of `../audiences.py`. TypeScript examples live in `../typescript/`.

The message YAML in `../messages/` is shared by every language. In your app, messages live at `plgkit/nudges/messages/`.

In your own app, the audience file lives at `plgkit/nudges/audiences.go`. Nudges config lives at `plgkit/nudges/config.yml` and is Nudges-only. Events are saved the same way in every language. Setup steps are in [the examples readme](../README.md#setup).

The context you pass to `decide` is a map, the same map the audience functions take. Put the person under `user` (`id`, `species`, `country_code`, `birth_date`, `is_staff`, `has_active_subscription`). Other facts sit beside `user`, such as `organization_id`.
