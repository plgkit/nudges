# React nudges

This package draws nudges in a React page. Your backend decides which ones. This package only shows them and sends what the person did.

## Page

`NudgeProvider` asks your backend once for the page. `NudgeSurface` is one slot. Put the slot anywhere inside the provider, even several layers down.

`decide` is a function you write. We call it with the location only. It calls your backend and returns the list. Read the latest page facts inside that function. This package does not pick the messages.

```jsx
const decide = (location) => yourBackend.decide(location);

<NudgeProvider
  location="home"
  endpoint="/api/nudges/events"
  context={{ organization_id: "acme" }}
  registry={{ Banner, OnboardingModal }}
  decide={decide}
>
  <header>
    <div>
      <NudgeSurface surface="main-top" />
    </div>
  </header>
</NudgeProvider>
```

`location` is the page. Every slot shares one answer, so the page limits still hold. We call `decide` again when the location changes, or when the context facts change. A new object with the same facts does not call it again.

`endpoint` is your URL. We POST `{ nudge_id, action, context }` there. `action` is `impression`, `click`, or `dismiss`. We never send `user_id`. The browser session cookie still goes out on its own, and your server reads the user from that session.

`context` is extra facts about the page, such as the organization. We send those facts with each event. If `user_id` is in there, we drop it. A component does not pass these facts itself.

`registry` maps a component name to your React component. `Banner` and `OnboardingModal` in this package match the two sample messages.

## What a component receives

`nudge_id` is the message id (the file name without `.yml`). The other props are `render_props` from the backend, unchanged. If those props also include `nudge_id`, the message id wins.

`surface` and `component` are not passed to your component.

## Tracking

```jsx
function Banner(props) {
  const { click, dismiss } = useNudgeTracking(props.nudge_id);
}
```

A view is recorded once each time `decide` returns, and only if that component is actually on screen. Drawing it again, or mounting it again for the same result, does not count. A new `decide` result can count again.

`click` and `dismiss` send those actions. If a button has `dismiss_on_click`, call `click`, then `dismiss`. The sample banner and modal do that for their main button.

If a slot sits outside the provider, or the component name is missing from the registry, nothing is drawn and the console gets a warning. The page keeps working. A failed request does not crash the page.
