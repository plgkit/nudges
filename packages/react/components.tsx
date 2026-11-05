import { useEffect, useRef, useState } from "react";
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
  const hasCopy = Boolean(props.title || props.body);
  return (
    <aside className="nudge-banner">
      <div className="nudge-banner__main">
        {props.asset ? <img src={props.asset} alt={props.title ?? ""} /> : null}
        {hasCopy ? (
          <div className="nudge-banner__copy">
            {props.title ? <h2>{props.title}</h2> : null}
            {props.body ? <p>{props.body}</p> : null}
          </div>
        ) : null}
      </div>
      {props.primary_cta || props.dismissible ? (
        <div className="nudge-banner__actions">
          {props.primary_cta ? (
            <Cta cta={props.primary_cta} click={click} dismiss={dismiss} />
          ) : null}
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
        </div>
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
  padding: "var(--space-5, 24px)",
} as const;

/** Matches the get-started onboarding sample message. */
export function OnboardingModal(props: OnboardingModalProps) {
  const { click, dismiss } = useNudgeTracking(props.nudge_id);
  const [open, setOpen] = useState(true);
  const closeVisuallyRef = useRef(() => setOpen(false));
  closeVisuallyRef.current = () => setOpen(false);
  const dialogRef = useRef<HTMLElement>(null);
  const validSlides = (Array.isArray(props.slides) ? props.slides : []).filter(
    (slide): slide is OnboardingSlide => Boolean(slide && typeof slide === "object"),
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const slideCount = validSlides.length;
  const slideIndex = slideCount === 0 ? 0 : Math.min(activeIndex, slideCount - 1);
  const slide = validSlides[slideIndex];
  const label = slide?.title ?? validSlides[0]?.title ?? "Onboarding";
  const dismissible = props.dismissible === true;
  const canStep = slideCount > 1;

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && dismissible) {
        event.preventDefault();
        closeVisuallyRef.current();
        return;
      }
      if (!canStep) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setActiveIndex((current) => Math.min(current + 1, slideCount - 1));
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setActiveIndex((current) => Math.max(current - 1, 0));
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [dismissible, open, canStep, slideCount]);

  if (typeof document === "undefined" || !open) return null;

  return createPortal(
    <div
      className="nudge-modal"
      data-nudge-portal={props.nudge_id}
      style={overlayStyle}
      onClick={(event) => {
        if (!dismissible) return;
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <section
        ref={dialogRef}
        className={canStep ? "nudge-modal__dialog nudge-modal__dialog--tabs" : "nudge-modal__dialog"}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        {dismissible ? (
          <button
            type="button"
            className="nudge-modal__close"
            aria-label="Close"
            onClick={() => dismiss()}
          >
            ×
          </button>
        ) : null}
        <div className={canStep ? "nudge-modal__body nudge-modal__body--tabs" : "nudge-modal__body"}>
          {canStep ? (
            <div className="nudge-modal__tabs" role="tablist" aria-label="Slides" aria-orientation="vertical">
              {validSlides.map((entry, index) => {
                const tabId = `${props.nudge_id}-tab-${index}`;
                const tabLabel = entry.title?.trim() || `Slide ${index + 1}`;
                return (
                  <button
                    key={`${entry.title ?? "slide"}-tab-${index}`}
                    type="button"
                    id={tabId}
                    className="nudge-modal__tab"
                    role="tab"
                    aria-selected={index === slideIndex}
                    aria-controls={`${props.nudge_id}-slide-panel`}
                    onClick={() => setActiveIndex(index)}
                  >
                    {tabLabel}
                  </button>
                );
              })}
            </div>
          ) : null}
          <div
            className="nudge-modal__panel"
            role={canStep ? "tabpanel" : undefined}
            id={canStep ? `${props.nudge_id}-slide-panel` : undefined}
            aria-labelledby={
              canStep ? `${props.nudge_id}-tab-${slideIndex}` : `${props.nudge_id}-slide-title`
            }
          >
            {slide ? (
              <article key={`${slide.title ?? "slide"}-${slideIndex}`} className="nudge-modal__slide">
                {slide.asset ? <img src={slide.asset} alt={slide.title ?? ""} /> : null}
                {slide.title ? <h2 id={`${props.nudge_id}-slide-title`}>{slide.title}</h2> : null}
                {slide.subtitle ? <p>{slide.subtitle}</p> : null}
                {slide.primary_cta ? (
                  <Cta
                    className="nudge-modal__cta"
                    cta={slide.primary_cta}
                    click={click}
                    dismiss={() => setOpen(false)}
                  />
                ) : null}
              </article>
            ) : null}
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function Cta({
  className,
  cta,
  click,
  dismiss,
}: {
  className?: string;
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
      <a className={className} href={cta.url} onClick={onClick}>
        {cta.text}
      </a>
    );
  }
  return (
    <button type="button" className={className} onClick={onClick}>
      {cta.text}
    </button>
  );
}
