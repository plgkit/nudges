/**
 * @vitest-environment jsdom
 */
import { createRoot, type Root } from "react-dom/client";
import { StrictMode, act, memo, useState, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Banner as SampleBanner,
  NudgeProvider,
  NudgeSurface,
  OnboardingModal,
  type BannerProps,
} from "./index.js";
import type { NudgeItem } from "./types.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const bannerId = "20261030183743-home-supersuit-launch-banner";
const modalId = "20261102131452-get-started-supersuit-onboarding-modal";

const bannerItem: NudgeItem = {
  id: bannerId,
  surface: "main-top",
  component: "Banner",
  render_props: {
    nudge_id: "from-render-props",
    dismissible: true,
    asset: "/static/nudges/20261030183743-home-supersuit-launch-banner/banner.png",
    title: "Supersuit v0 available in beta.",
    body: "The people's first supersuit brings you levitation, accelerated movements, and more. Take it to new heights.",
    primary_cta: {
      text: "Join the waitlist",
      url: "https://supersuit.tech/examples/v0-waitlist",
      dismiss_on_click: true,
    },
  },
};

const modalItem: NudgeItem = {
  id: modalId,
  surface: "modal",
  component: "OnboardingModal",
  render_props: {
    dismissible: true,
    slides: [
      {
        title: "It's time to suit up",
        subtitle: "You need to believe, to achieve.",
        asset: "/static/nudges/20261102131452-get-started-supersuit-onboarding-modal/slide_1.png",
        primary_cta: {
          text: "Activate your suit",
          url: "https://supersuit.tech/examples/activate-your-suit",
          dismiss_on_click: true,
        },
      },
    ],
  },
};

let fetchMock: ReturnType<typeof vi.fn>;
const cleanups: Array<() => void> = [];

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount(node: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(node);
  });
  const handle = {
    container,
    rerender(next: ReactElement) {
      act(() => {
        root.render(next);
      });
    },
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
  cleanups.push(handle.unmount);
  return handle;
}

async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function postedBodies() {
  return fetchMock.mock.calls.map((call) => {
    const init = call[1] as RequestInit;
    return {
      url: String(call[0]),
      method: init.method,
      headers: init.headers,
      body: JSON.parse(String(init.body)) as {
        nudge_id?: string;
        action?: string;
        context?: Record<string, unknown>;
        user_id?: string;
      },
    };
  });
}

describe("NudgeSurface", () => {
  it("shows only the items for that surface and asks decide once", async () => {
    const secondTop: NudgeItem = {
      id: "20261030190000-home-second-banner",
      surface: "main-top",
      component: "Banner",
      render_props: { title: "Second banner on the same slot" },
    };
    const decide = vi.fn(async () => [bannerItem, secondTop, modalItem]);

    const view = mount(
      <NudgeProvider
        location="home"
        endpoint="/api/nudges/events"
        context={{ organization_id: "acme", user_id: "u_123" }}
        registry={{ Banner: SampleBanner, OnboardingModal }}
        decide={decide}
      >
        <header>
          <div>
            <NudgeSurface surface="main-top" />
          </div>
        </header>
        <NudgeSurface surface="sidebar" />
        <main>
          <NudgeSurface surface="modal" />
        </main>
      </NudgeProvider>,
    );
    await settle();

    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide).toHaveBeenCalledWith("home", { organization_id: "acme" });
    expect(JSON.stringify(decide.mock.calls[0])).not.toContain("u_123");

    view.rerender(
      <NudgeProvider
        location="home"
        endpoint="/api/nudges/events"
        context={{ user_id: "u_123", organization_id: "acme" }}
        registry={{ Banner: SampleBanner, OnboardingModal }}
        decide={decide}
      >
        <header>
          <div>
            <NudgeSurface surface="main-top" />
          </div>
        </header>
        <NudgeSurface surface="sidebar" />
        <main>
          <NudgeSurface surface="modal" />
        </main>
      </NudgeProvider>,
    );
    await settle();
    expect(decide).toHaveBeenCalledTimes(1);

    view.rerender(
      <NudgeProvider
        location="home"
        endpoint="/api/nudges/events"
        context={{ organization_id: "other" }}
        registry={{ Banner: SampleBanner, OnboardingModal }}
        decide={decide}
      >
        <header>
          <div>
            <NudgeSurface surface="main-top" />
          </div>
        </header>
        <NudgeSurface surface="sidebar" />
        <main>
          <NudgeSurface surface="modal" />
        </main>
      </NudgeProvider>,
    );
    await settle();
    expect(decide).toHaveBeenCalledTimes(2);
    expect(decide).toHaveBeenLastCalledWith("home", { organization_id: "other" });

    const banner = view.container.querySelector(`aside`);
    const modal = document.body.querySelector(`[role="dialog"]`);
    expect(banner?.textContent).toContain("Supersuit v0 available in beta.");
    expect(view.container.textContent).toContain("Second banner on the same slot");
    expect(banner?.textContent).not.toContain("It's time to suit up");
    expect(banner?.querySelector("img")?.getAttribute("src")).toBe(
      "/static/nudges/20261030183743-home-supersuit-launch-banner/banner.png",
    );
    expect(modal?.textContent).toContain("It's time to suit up");
    expect(modal?.textContent).toContain("You need to believe, to achieve.");
    expect(modal?.textContent).not.toContain("Supersuit v0 available in beta.");
    expect(view.container.querySelectorAll("[data-nudge-id]")).toHaveLength(3);
    expect(view.container.querySelector(`[data-nudge-id="${bannerId}"] img`)?.getAttribute("src")).toBe(
      bannerItem.render_props?.asset,
    );
  });

  it("passes render_props through and lets the message id win", async () => {
    function Probe(props: Record<string, unknown>) {
      return (
        <p
          data-received={String(props.nudge_id)}
          data-surface={String("surface" in props)}
          data-component={String("component" in props)}
        >
          {String(props.title)}
        </p>
      );
    }

    const decide = vi.fn(async () => [{ ...bannerItem, component: "Probe" }]);
    const view = mount(
      <NudgeProvider
        location="home"
        endpoint="/api/nudges/events"
        registry={{ Probe: memo(Probe) }}
        decide={decide}
      >
        <NudgeSurface surface="main-top" />
      </NudgeProvider>,
    );
    await settle();
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide).toHaveBeenCalledWith("home", undefined);

    const node = view.container.querySelector("p");
    expect(node?.getAttribute("data-received")).toBe(bannerId);
    expect(node?.textContent).toBe("Supersuit v0 available in beta.");
    expect(node?.getAttribute("data-surface")).toBe("false");
    expect(node?.getAttribute("data-component")).toBe("false");
    expect(postedBodies().map((post) => post.body.action)).toEqual([]);
  });

  it("warns and renders nothing outside a provider", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const view = mount(<NudgeSurface surface="main-top" />);
    await settle();

    expect(view.container.textContent).toBe("");
    expect(view.container.querySelector("[data-nudge-id]")).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      'NudgeSurface for "main-top" is outside NudgeProvider. Showing nothing.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("warns and renders nothing when the component is missing or unknown", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const items = [
      null,
      { id: "missing-name", surface: "main-top", render_props: { title: "Nope" } },
      {
        id: "unknown-name",
        surface: "main-top",
        component: "Ghost",
        render_props: { title: "Also nope" },
      },
      { id: "missing-props", surface: "main-top", component: "Banner" },
    ];
    const view = mount(
      <NudgeProvider
        location="home"
        endpoint="/api/nudges/events"
        registry={{ Banner: SampleBanner }}
        decide={async () => items as NudgeItem[]}
      >
        <NudgeSurface surface="main-top" />
      </NudgeProvider>,
    );
    await settle();

    expect(view.container.textContent).toBe("");
    expect(view.container.querySelector("aside")).toBeNull();
    expect(warn).toHaveBeenCalledWith("NudgeProvider skipped a decide() row it could not read.");
    expect(warn).toHaveBeenCalledWith('Nudge "missing-name" has no component name. Showing nothing.');
    expect(warn).toHaveBeenCalledWith(
      'Nudge "unknown-name" names component "Ghost", which is not in the registry. Showing nothing.',
    );
    expect(warn).toHaveBeenCalledWith('Nudge "missing-props" has no render_props. Showing nothing.');
    expect(postedBodies()).toEqual([]);
  });

  it("opens OnboardingModal over the page", async () => {
    function show(dismissible: boolean) {
      return (
        <NudgeProvider
          location="get-started"
          endpoint="/api/nudges/events"
          context={{ organization_id: "acme" }}
          registry={{ OnboardingModal }}
          decide={async () => [
            {
              ...modalItem,
              render_props: { ...modalItem.render_props, dismissible },
            },
          ]}
        >
          <main>
            <NudgeSurface surface="modal" />
          </main>
        </NudgeProvider>
      );
    }

    const view = mount(show(true));
    await settle();
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    const overlay = dialog?.parentElement;
    expect(view.container.querySelector('[role="dialog"]')).toBeNull();
    expect(overlay?.parentElement).toBe(document.body);
    expect(overlay?.className).toBe("nudge-modal");
    expect(overlay?.style.position).toBe("fixed");
    expect(overlay?.style.inset).toBe("0");
    expect(overlay?.style.zIndex).toBe("1000");
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(dialog);
    expect(document.body.style.overflow).toBe("hidden");
    expect(postedBodies().some((post) => post.body.action === "impression")).toBe(true);

    const dismissCount = () => postedBodies().filter((post) => post.body.action === "dismiss").length;

    await act(async () => {
      overlay?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(dismissCount()).toBe(1);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.style.overflow).toBe("");

    view.unmount();

    mount(show(true));
    await settle();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(dismissCount()).toBe(2);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();

    mount(show(true));
    await settle();
    const overlayAgain = document.body.querySelector<HTMLElement>('[role="dialog"]')?.parentElement;
    const close = overlayAgain?.querySelector("button");
    if (!close) throw new Error("missing close button");
    await act(async () => {
      close.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(dismissCount()).toBe(3);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();

    mount(show(false));
    await settle();
    const quiet = document.body.querySelector(".nudge-modal");
    expect(quiet?.querySelector("button")).toBeNull();
    const before = dismissCount();
    await act(async () => {
      quiet?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(dismissCount()).toBe(before);
  });
});

describe("tracking", () => {
  function DrawingBanner(props: BannerProps) {
    const [tick, setTick] = useState(0);
    return (
      <div>
        <button type="button" onClick={() => setTick((n) => n + 1)}>
          redraw {tick}
        </button>
        <SampleBanner key={tick > 1 ? "again" : "once"} {...props} />
      </div>
    );
  }

  function Page({
    location,
    org,
    show = true,
  }: {
    location: string;
    org: string;
    show?: boolean;
  }) {
    return (
      <NudgeProvider
        location={location}
        endpoint="/api/nudges/events"
        context={{ organization_id: org, user_id: "u_123" }}
        registry={{ Banner: DrawingBanner }}
        decide={async () => [bannerItem]}
      >
        {show ? (
          <header>
            <div>
              <NudgeSurface surface="main-top" />
            </div>
          </header>
        ) : null}
        <NudgeSurface surface="modal" />
      </NudgeProvider>
    );
  }

  it("records an impression once per decide result", async () => {
    const view = mount(<Page location="home" org="acme" />);
    await settle();
    expect(postedBodies().map((post) => post.body.action)).toEqual(["impression"]);

    view.rerender(<Page location="home" org="acme" />);
    await settle();
    const redraw = view.container.querySelector("button");
    if (!redraw) throw new Error("missing redraw button");
    await act(async () => {
      redraw.click();
    });
    await settle();
    await act(async () => {
      view.container.querySelector("button")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await settle();
    expect(postedBodies().map((post) => post.body.action)).toEqual(["impression"]);

    view.rerender(<Page location="home" org="acme" show={false} />);
    await settle();
    view.rerender(<Page location="home" org="acme" show />);
    await settle();
    expect(postedBodies().map((post) => post.body.action)).toEqual(["impression"]);

    view.rerender(<Page location="get-started" org="acme" />);
    await settle();
    expect(postedBodies().map((post) => post.body.action)).toEqual(["impression", "impression"]);

    view.rerender(<Page location="home" org="other" />);
    await settle();
    expect(postedBodies().map((post) => post.body.action)).toEqual([
      "impression",
      "impression",
      "impression",
    ]);
  });

  it("does not count a second impression when the tree remounts in Strict Mode", async () => {
    mount(
      <StrictMode>
        <Page location="home" org="acme" />
      </StrictMode>,
    );
    await settle();
    expect(postedBodies().map((post) => post.body.action)).toEqual(["impression"]);
  });

  it("does not count a nudge inside a hidden spot", async () => {
    mount(
      <div style={{ display: "none" }}>
        <Page location="home" org="acme" />
      </div>,
    );
    await settle();
    expect(postedBodies()).toEqual([]);
  });

  it("does not throw when decide() fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const view = mount(
      <NudgeProvider
        location="home"
        endpoint="/api/nudges/events"
        registry={{ Banner: SampleBanner }}
        decide={async () => {
          throw new Error("down");
        }}
      >
        <NudgeSurface surface="main-top" />
      </NudgeProvider>,
    );
    await settle();
    expect(view.container.textContent).toBe("");
    expect(warn).toHaveBeenCalledWith(
      "NudgeProvider decide() failed. Showing nothing.",
      expect.any(Error),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("waits to count until the page is actually visible", async () => {
    const original = document.visibilityState;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    try {
      mount(<Page location="home" org="acme" />);
      await settle();
      expect(postedBodies()).toEqual([]);

      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await settle();
      expect(postedBodies().map((post) => post.body.action)).toEqual(["impression"]);
    } finally {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => original,
      });
    }
  });

  it("POSTs nudge_id, action, and context, and never user_id", async () => {
    const view = mount(
      <NudgeProvider
        location="home"
        endpoint="/api/nudges/events"
        context={{ organization_id: "acme", user_id: "u_123", note: undefined }}
        registry={{ Banner: SampleBanner, OnboardingModal }}
        decide={async () => [bannerItem, modalItem]}
      >
        <NudgeSurface surface="main-top" />
        <NudgeSurface surface="modal" />
      </NudgeProvider>,
    );
    await settle();

    const impression = postedBodies();
    expect(impression).toHaveLength(2);
    for (const post of impression) {
      expect(post.url).toBe("/api/nudges/events");
      expect(post.method).toBe("POST");
      expect(post.headers).toEqual({ "content-type": "application/json" });
      expect(post.body.user_id).toBeUndefined();
      expect(JSON.stringify(post.body)).not.toContain("u_123");
      expect(post.body.context).toEqual({ organization_id: "acme" });
      expect(post.body.action).toBe("impression");
    }
    expect(impression.map((post) => post.body.nudge_id).sort()).toEqual([bannerId, modalId].sort());

    document.addEventListener("click", (event) => event.preventDefault());
    const link = Array.from(view.container.querySelectorAll("a")).find((node) =>
      node.textContent?.includes("Join the waitlist"),
    );
    if (!link) throw new Error("missing banner link");
    await act(async () => {
      link.click();
    });

    const afterClick = postedBodies();
    expect(afterClick.map((post) => `${post.body.nudge_id}:${post.body.action}`)).toEqual([
      `${bannerId}:impression`,
      `${modalId}:impression`,
      `${bannerId}:click`,
      `${bannerId}:dismiss`,
    ]);

    const modalLink = Array.from(document.body.querySelectorAll("a")).find((node) =>
      node.textContent?.includes("Activate your suit"),
    );
    if (!modalLink) throw new Error("missing modal link");
    await act(async () => {
      modalLink.click();
    });
    expect(postedBodies().slice(-2).map((post) => post.body.action)).toEqual(["click", "dismiss"]);
    expect(postedBodies().slice(-1)[0]?.body.nudge_id).toBe(modalId);

    view.unmount();
    const bannerOnly = mount(
      <NudgeProvider
        location="home"
        endpoint="/api/nudges/events"
        context={{ organization_id: "acme" }}
        registry={{ Banner: SampleBanner }}
        decide={async () => [bannerItem]}
      >
        <NudgeSurface surface="main-top" />
      </NudgeProvider>,
    );
    await settle();
    const close = bannerOnly.container.querySelector("aside button");
    if (!close) throw new Error("missing close button");
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await act(async () => {
      (close as HTMLButtonElement).click();
    });
    await settle();
    expect(warn).toHaveBeenCalledWith("Nudge event could not be sent.", expect.any(Error));
    expect(bannerOnly.container.querySelector("aside")).toBeNull();
  });
});
