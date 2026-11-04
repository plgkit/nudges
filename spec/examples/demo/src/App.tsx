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
      <h1>Home</h1>
      <p>The banner sits in the header, a few layers down.</p>
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
      <main className="page-modal-slot">
        <NudgeSurface surface="modal" />
      </main>
      <h1>Get started</h1>
      <p>The onboarding message sits in the modal slot.</p>
    </NudgeProvider>
  );
}
