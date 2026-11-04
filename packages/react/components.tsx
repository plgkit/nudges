import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useNudgeTracking } from "./tracking.js";

export type NudgeCta = {
  text?: string;
  url?: string;
  /** When true, this control calls click, then dismiss. */
  dismiss_on_click?: boolean;
};

export type BannerProps = {
  nudge_id: string;
  dismissible?: boolean;
  asset?: string;
  title?: string;
  body?: string;
  primary_cta?: NudgeCta;
};

export type OnboardingSlide = {
  title?: string;
  subtitle?: string;
  asset?: string;
  primary_cta?: NudgeCta;
};

export type OnboardingModalProps = {
  nudge_id: string;
  dismissible?: boolean;
  slides?: OnboardingSlide[];
};

/** Matches the home banner sample message. */
export function Banner(props: BannerProps) {
  const { click, dismiss } = useNudgeTracking(props.nudge_id);
  return (
    <aside className="nudge-banner">
      {props.dismissible ? (
        <button
          type="button"
          className="nudge-banner__close"
          aria-label="Close"
          onClick={() => dismiss()}
        >
          ×
        </button>
      ) : null}
      {props.asset ? <img src={props.asset} alt={props.title ?? ""} /> : null}
      {props.title ? <h2>{props.title}</h2> : null}
      {props.body ? <p>{props.body}</p> : null}
      {props.primary_cta ? (
        <Cta cta={props.primary_cta} click={click} dismiss={dismiss} />
      ) : null}
    </aside>
  );
}

const overlayStyle = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxSizing: "border-box",
  padding: "var(--space-5)",
  background: "color-mix(in srgb, var(--color-neutral-900) 55%, transparent)",
} as const;

const dialogStyle = {
  width: "min(640px, 100%)",
  maxHeight: "calc(100vh - var(--space-8))",
  overflow: "auto",
  boxSizing: "border-box",
  background: "var(--color-neutral-50)",
  border: "1px solid var(--color-neutral-200)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-md)",
  padding: "var(--space-5)",
} as const;

/** Matches the get-started onboarding sample message. */
export function OnboardingModal(props: OnboardingModalProps) {
  const { click, dismiss } = useNudgeTracking(props.nudge_id);
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  const dialogRef = useRef<HTMLElement>(null);
  const slides = Array.isArray(props.slides) ? props.slides : [];
  const label = slides[0]?.title ?? "Onboarding";
  const dismissible = props.dismissible === true;

  useEffect(() => {
    dialogRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || !dismissible) return;
      event.preventDefault();
      dismissRef.current();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [dismissible]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="nudge-modal"
      data-nudge-portal={props.nudge_id}
      style={overlayStyle}
      onClick={(event) => {
        if (!dismissible) return;
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        style={dialogStyle}
      >
        {slides.map((slide, index) => {
          if (!slide || typeof slide !== "object") return null;
          return (
            <article key={`${slide.title ?? "slide"}-${index}`}>
              {slide.asset ? <img src={slide.asset} alt={slide.title ?? ""} /> : null}
              {slide.title ? <h2>{slide.title}</h2> : null}
              {slide.subtitle ? <p>{slide.subtitle}</p> : null}
              {slide.primary_cta ? (
                <Cta cta={slide.primary_cta} click={click} dismiss={dismiss} />
              ) : null}
            </article>
          );
        })}
        {dismissible ? (
          <button type="button" onClick={() => dismiss()}>
            Close
          </button>
        ) : null}
      </section>
    </div>,
    document.body,
  );
}

function Cta({
  cta,
  click,
  dismiss,
}: {
  cta: NudgeCta;
  click: () => void;
  dismiss: () => void;
}) {
  if (!cta || typeof cta !== "object" || !cta.text) return null;
  const onClick = () => {
    click();
    if (cta.dismiss_on_click) dismiss();
  };
  if (cta.url) {
    return (
      <a href={cta.url} onClick={onClick}>
        {cta.text}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick}>
      {cta.text}
    </button>
  );
}
