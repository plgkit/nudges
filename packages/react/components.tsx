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
    <aside>
      {props.asset ? <img src={props.asset} alt={props.title ?? ""} /> : null}
      {props.title ? <h2>{props.title}</h2> : null}
      {props.body ? <p>{props.body}</p> : null}
      {props.primary_cta ? (
        <Cta cta={props.primary_cta} click={click} dismiss={dismiss} />
      ) : null}
      {props.dismissible ? (
        <button type="button" onClick={() => dismiss()}>
          Close
        </button>
      ) : null}
    </aside>
  );
}

/** Matches the get-started onboarding sample message. */
export function OnboardingModal(props: OnboardingModalProps) {
  const { click, dismiss } = useNudgeTracking(props.nudge_id);
  const slides = Array.isArray(props.slides) ? props.slides : [];
  const label = slides[0]?.title ?? "Onboarding";
  return (
    <section role="dialog" aria-label={label}>
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
      {props.dismissible ? (
        <button type="button" onClick={() => dismiss()}>
          Close
        </button>
      ) : null}
    </section>
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
