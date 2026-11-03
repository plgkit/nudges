import { useEffect, useState } from "react";
import {
  Banner,
  NudgeProvider,
  NudgeSurface,
  OnboardingModal,
  type DecideFn,
} from "../../../../packages/react/index.ts";

const decide: DecideFn = async (location, context) => {
  const response = await fetch("/api/nudges/decide", {
    method: "POST",
    headers: { "content-type": "application/json" },
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

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <div className="wrap">
      <nav>
        <a href="#/home" aria-current={page === "home" ? "page" : undefined}>
          Home
        </a>
        <a href="#/get-started" aria-current={page === "get-started" ? "page" : undefined}>
          Get started
        </a>
      </nav>
      {page === "home" ? <Home /> : <GetStarted />}
    </div>
  );
}

function Home() {
  return (
    <NudgeProvider
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

function GetStarted() {
  return (
    <NudgeProvider
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
