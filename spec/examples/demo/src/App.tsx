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
    <div className={user.name === "user_one" ? "app user-one" : "app user-two"}>
      <div className="wrap">
        <div className="who">
          <strong>Signed in as {user.name}</strong>
          <span>
            <button type="button" aria-pressed={user.name === "user_one"} onClick={() => void choose("user_one")}>
              user_one
            </button>
            <button type="button" aria-pressed={user.name === "user_two"} onClick={() => void choose("user_two")}>
              user_two
            </button>
          </span>
        </div>
        <nav>
          <a href="#/home" aria-current={page === "home" ? "page" : undefined}>
            Home
          </a>
          <a href="#/get-started" aria-current={page === "get-started" ? "page" : undefined}>
            Get started
          </a>
        </nav>
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
      <header>
        <div>
          <NudgeSurface surface="main-top" />
        </div>
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
      <main>
        <NudgeSurface surface="modal" />
      </main>
      <h1>Get started</h1>
      <p>The onboarding message sits in the modal slot.</p>
    </NudgeProvider>
  );
}
