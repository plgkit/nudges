import { useEffect, useState } from "react";
import {
  Banner,
  NudgeProvider,
  NudgeSurface,
  OnboardingModal,
  type DecideFn,
} from "../../../../packages/react/index.ts";

type DemoUser = { id: "1" | "2"; name: "user_one" | "user_two" };

const decide: DecideFn = async (location, context) => {
  const response = await fetch("/api/nudges/decide", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ location, context }),
  });
  if (!response.ok) return [];
  const body: unknown = await response.json();
  return Array.isArray(body) ? body : [];
};

function pageFromHash(): "home" | "get-started" {
  return window.location.hash === "#/get-started" ? "get-started" : "home";
}

function otherUser(user: DemoUser): DemoUser {
  return user.name === "user_one"
    ? { id: "2", name: "user_two" }
    : { id: "1", name: "user_one" };
}

function UserSwitcher({
  user,
  onChoose,
}: {
  user: DemoUser;
  onChoose: (name: DemoUser["name"]) => void;
}) {
  const inactive = otherUser(user);
  return (
    <div className="user-stack">
      <button
        type="button"
        className="user-stack__avatar user-stack__avatar--back"
        aria-label={`Switch to user ${inactive.id}`}
        onClick={() => onChoose(inactive.name)}
      >
        {inactive.id}
      </button>
      <div className="user-stack__avatar user-stack__avatar--front" aria-hidden="true">
        {user.id}
      </div>
    </div>
  );
}

export function App() {
  const [page, setPage] = useState(pageFromHash);
  const [user, setUser] = useState<DemoUser | null>(null);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    void fetch("/api/nudges/session", { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error("no session");
        return (await response.json()) as DemoUser;
      })
      .then(setUser)
      .catch(() => setProblem("Start a backend on port 8787, then refresh this page."));
  }, []);

  async function choose(name: DemoUser["name"]) {
    const response = await fetch("/api/nudges/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ user: name }),
    });
    if (!response.ok) return;
    setUser((await response.json()) as DemoUser);
  }

  if (problem) {
    return (
      <div className="wrap">
        <p>{problem}</p>
      </div>
    );
  }
  if (!user) {
    return (
      <div className="wrap">
        <p>Loading…</p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <nav className="topbar__nav">
          <a href="#/home" aria-current={page === "home" ? "page" : undefined}>
            Home
          </a>
          <a href="#/get-started" aria-current={page === "get-started" ? "page" : undefined}>
            Get started
          </a>
        </nav>
        <UserSwitcher user={user} onChoose={(name) => void choose(name)} />
      </header>
      <div className="wrap">
        {page === "home" ? <Home user={user} /> : <GetStarted user={user} />}
      </div>
    </div>
  );
}

function Home({ user }: { user: DemoUser }) {
  return (
    <NudgeProvider
      key={user.id}
      location="home"
      endpoint="/api/nudges/events"
      context={{ organization_id: "acme" }}
      registry={{ Banner }}
      decide={decide}
    >
      <header className="page-banner-slot">
        <NudgeSurface surface="main-top" />
      </header>
      <div className="page-body page-body--home">
        <h1>Sub-suit</h1>

        <section className="page-metrics" aria-label="Key sub-suit metrics">
          <article className="page-metric-card">
            <p className="page-metric-card__value">
              92<span className="page-metric-card__unit">%</span>
            </p>
            <p className="page-metric-card__label">Power core</p>
          </article>
          <article className="page-metric-card">
            <p className="page-metric-card__value">
              14.2<span className="page-metric-card__unit">h</span>
            </p>
            <p className="page-metric-card__label">Flight time this week</p>
          </article>
          <article className="page-metric-card">
            <p className="page-metric-card__value">
              98<span className="page-metric-card__unit">%</span>
            </p>
            <p className="page-metric-card__label">Stability index</p>
          </article>
        </section>

        <section className="page-panel" aria-label="Unit status">
          <div className="page-panel__head">
            <div>
              <h2 className="page-panel__title">Trainer Mark I</h2>
              <p className="page-panel__sub">Unit 7 · Dock 3</p>
            </div>
            <span className="page-badge page-badge--ready">Ready to fly</span>
          </div>
          <p className="page-meta">Last flight · Yesterday · River North · 22 min</p>
          <div className="page-actions">
            <button type="button" className="page-btn page-btn--primary">
              Run diagnostics
            </button>
            <button type="button" className="page-btn">
              Flight log
            </button>
          </div>
        </section>

        <section className="page-snapshot" aria-label="Systems snapshot">
          <h2 className="page-snapshot__title">Systems snapshot</h2>
          <dl className="page-snapshot__list">
            <div>
              <dt>Gauntlets</dt>
              <dd>Synced · 100%</dd>
            </div>
            <div>
              <dt>Cape stabilizers</dt>
              <dd>Auto-tuned</dd>
            </div>
            <div>
              <dt>Thrusters</dt>
              <dd>Training cap · 40%</dd>
            </div>
            <div>
              <dt>Hero network</dt>
              <dd>Not paired</dd>
            </div>
            <div>
              <dt>Firmware</dt>
              <dd>Sub-suit 2.4.1</dd>
            </div>
            <div>
              <dt>Next service</dt>
              <dd>In 12 days</dd>
            </div>
          </dl>
        </section>

        <p className="page-footnote">Telemetry synced 8:15 AM · No maintenance alerts</p>
      </div>
    </NudgeProvider>
  );
}

function GetStarted({ user }: { user: DemoUser }) {
  return (
    <NudgeProvider
      key={user.id}
      location="get-started"
      endpoint="/api/nudges/events"
      context={{ organization_id: "acme" }}
      registry={{ OnboardingModal }}
      decide={decide}
    >
      <NudgeSurface surface="modal" />
    </NudgeProvider>
  );
}
