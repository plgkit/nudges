# Examples

This folder is a sample setup you copy into your app.

## Where it goes

```
your-app/
  plgkit/
    nudges/
      config.yml
      messages/
        20261030183743-home-supersuit-launch-banner.yml
        20261102131452-get-started-supersuit-onboarding-modal.yml
      audiences.py
```

Use `audiences.go` or `audiences.ts` instead of `audiences.py` if your app is Go or TypeScript. Those samples are in `go/` and `typescript/`.

## What each file is

- `config.yml` sets where images live and how many messages a page can show.
- `messages/` holds one file per message. The filename is the message id.
- `audiences.py` (or `.go` / `.ts`) is where you say who should see a message.
- `decide-response.json` is an example of what the backend returns. You do not copy this file into your app.

## How it works

1. You write a message file.
2. Your backend calls `decide()` and gets back what to show.
3. The renderer shows that component.
4. Clicks and dismisses are sent with POST to your endpoint.

The React renderer is [`packages/react`](../../packages/react/README.md). It does not live in this folder. You pass a `decide` function that calls your backend and returns the list. The provider calls that function once for the page. Each slot then draws its own messages. `Banner` and `OnboardingModal` from that package match the two sample messages.

```jsx
const decide = (location) => yourBackend.decide(location);
```

## Using it in a page

The home banner is location `home`, surface `main-top`, component `Banner`. The slot sits a few layers down. The provider calls `decide("home")` once for every slot on this page.

```jsx
<NudgeProvider location="home" endpoint="/api/nudges/events" context={{ organization_id: "acme" }} registry={{ Banner }} decide={decide}>
  <header>
    <div>
      <NudgeSurface surface="main-top" />
    </div>
  </header>
</NudgeProvider>
```

The onboarding modal is location `get-started`, surface `modal`, component `OnboardingModal`.

```jsx
<NudgeProvider location="get-started" endpoint="/api/nudges/events" context={{ organization_id: "acme" }} registry={{ OnboardingModal }} decide={decide}>
  <main>
    <NudgeSurface surface="modal" />
  </main>
</NudgeProvider>
```

Details: [messages/README.md](messages/README.md) and [renderers](../renderers.md).
