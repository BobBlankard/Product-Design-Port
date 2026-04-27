const prefersReducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)"
).matches;

const scrollProgressEl = document.querySelector(".scroll-progress");
const splitHeadingEls = document.querySelectorAll(".split-lines");
const themeSections = document.querySelectorAll("[data-theme-section]");

let lenis = null;
let pinhausHiwHeaderProgressTarget = 0;
let pinhausHiwHeaderProgressDisplayed = 0;
let pinhausHiwHeaderProgressRaf = 0;

let bandhouseIgProblemRoot = null;
let bandhouseIgScrubTimer = 0;
let bandhouseIgLastRatio = -1;
let bandhouseIMsgStarted = false;
let bandhouseStatRows = [];
let bandhouseSolutionFeedRoot = null;
const bandhouseIMsgTimers = [];
const bandhouseHoldTimers = [];
/** Linear scroll fraction through THE PROBLEM section where feed eases to the “tonight” hold. */
const BH_IG_DWELL_START = 0.79;

/** In-page TOC under editorial hero: Lenis blocks native hash scroll unless we scrollTo the target. */
/** Editorial case hero TOC: desktop = line left to row midpoint; mobile = line right to viewport inset. */
function updateCaseHeroTocGuideLines() {
  const split = document.querySelector(
    "main.case-page--editorial .case-hero-editorial__statement--split"
  );
  if (!split) {
    return;
  }

  const links = split.querySelectorAll(".case-hero-editorial__toc a");
  const narrow = window.matchMedia("(max-width: 720px)").matches;
  const vw = window.visualViewport?.width ?? window.innerWidth;

  if (narrow) {
    const insetFromRight = 20;
    links.forEach((link) => {
      const r = link.getBoundingClientRect();
      const fs = parseFloat(getComputedStyle(link).fontSize) || 16;
      const lineStartX = r.right + fs * 0.55;
      const w = vw - insetFromRight - lineStartX;
      link.style.setProperty(
        "--case-toc-line-w",
        `${Math.max(0, Math.round(w))}px`
      );
    });
    return;
  }

  const splitRect = split.getBoundingClientRect();
  const centerX = splitRect.left + splitRect.width / 2;

  links.forEach((link) => {
    const r = link.getBoundingClientRect();
    const fs = parseFloat(getComputedStyle(link).fontSize) || 16;
    const lineRightX = r.left - fs * 0.55;
    const w = lineRightX - centerX;
    link.style.setProperty(
      "--case-toc-line-w",
      `${Math.max(0, Math.round(w))}px`
    );
  });
}

function initCaseHeroTocGuideLines() {
  const split = document.querySelector(
    "main.case-page--editorial .case-hero-editorial__statement--split"
  );
  if (!split) {
    return;
  }
  updateCaseHeroTocGuideLines();
  requestAnimationFrame(() => requestAnimationFrame(updateCaseHeroTocGuideLines));
  window.addEventListener("resize", updateCaseHeroTocGuideLines, {
    passive: true,
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", updateCaseHeroTocGuideLines, {
      passive: true,
    });
  }
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => updateCaseHeroTocGuideLines()).observe(split);
  }
  if (document.fonts?.ready) {
    document.fonts.ready.then(updateCaseHeroTocGuideLines);
  }
}

/** Solution stack: prose block width tracks .case-solution-stack__band (headline + equals row), not long body copy */
function updateEditorialCaseSolutionBandWidth() {
  document
    .querySelectorAll("main.case-page--editorial .case-solution-stack")
    .forEach((stack) => {
      const band = stack.querySelector(".case-solution-stack__band");
      if (!band) {
        return;
      }
      const w = Math.round(band.getBoundingClientRect().width);
      stack.style.setProperty("--case-solution-band-px", `${w}px`);
      stack.dataset.bandMeasured = "true";
    });
}

/** PinHaus "How it works": scroll-scrubbed JPEG frames + left step list + connector line */
const PINHAUS_HIW_FRAME_SRCS = [
  "./assets/pinhaus/how-it-works/hiw-00.jpg",
  "./assets/pinhaus/how-it-works/hiw-01.jpg",
  "./assets/pinhaus/how-it-works/hiw-02.jpg",
  "./assets/pinhaus/how-it-works/hiw-03.jpg",
  "./assets/pinhaus/how-it-works/hiw-04.jpg",
  "./assets/pinhaus/how-it-works/hiw-05.jpg",
  "./assets/pinhaus/how-it-works/hiw-06.jpg",
  "./assets/pinhaus/how-it-works/hiw-07.jpg",
  "./assets/pinhaus/how-it-works/hiw-08.jpg",
];

const PINHAUS_HIW_FRAME_ALTS = [
  "PinHaus screen: explore a product listing.",
  "PinHaus screen: pin flow — choose a board.",
  "PinHaus screen: create a new board.",
  "PinHaus screen: profile — Boards tab.",
  "PinHaus screen: a board with pinned listings.",
  "PinHaus screen: find similar recommended listings.",
  "PinHaus screen: recommended grid (repeat).",
  "PinHaus screen: recommended listings with match scores.",
  "PinHaus screen: discover your style — personalized feed.",
];

const PINHAUS_HIW_STEPS = [
  { flatStart: 0, flatCount: 1 },
  { flatStart: 1, flatCount: 4 },
  { flatStart: 5, flatCount: 1 },
  { flatStart: 6, flatCount: 2 },
  { flatStart: 8, flatCount: 1 },
];

function pinhausHiwFlatIndexToStep(flat) {
  for (let i = 0; i < PINHAUS_HIW_STEPS.length; i += 1) {
    const s = PINHAUS_HIW_STEPS[i];
    if (flat < s.flatStart + s.flatCount) {
      return i;
    }
  }
  return PINHAUS_HIW_STEPS.length - 1;
}

function pinhausHiwGetScrollProgress(root) {
  const scrubGain = 2.1;
  const rect = root.getBoundingClientRect();
  const travel = Math.max(1, root.offsetHeight - window.innerHeight);
  const raw = -rect.top;
  const linear = Math.min(1, Math.max(0, raw / travel));
  const denom = 1 - Math.exp(-scrubGain);
  if (denom <= 1e-6) {
    return linear;
  }
  // Faster early scrub without saturating before the section ends.
  return (1 - Math.exp(-scrubGain * linear)) / denom;
}

/** Scroll document so the scrub timeline sits at the first frame of this step (matches list + dot strip). */
function pinhausHiwScrollRootToStepStart(root, step) {
  if (!root || root.dataset.reducedMotion === "true") {
    return;
  }
  const n = PINHAUS_HIW_FRAME_SRCS.length;
  if (n < 1) {
    return;
  }
  const travel = Math.max(1, root.offsetHeight - window.innerHeight);
  const rect = root.getBoundingClientRect();
  const flatStart = PINHAUS_HIW_STEPS[step]?.flatStart ?? 0;
  const p =
    flatStart >= n - 1 ? 1 : Math.min(1, Math.max(0, (flatStart + 0.5) / n));
  const delta = rect.top + p * travel;
  const y = getScrollY() + delta;
  const maxY = lenis
    ? lenis.limit
    : Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const capped = Math.min(maxY, Math.max(0, y));
  if (lenis) {
    lenis.scrollTo(capped, { immediate: true });
  } else {
    window.scrollTo(0, capped);
  }
}

let pinhausHiwRoot = null;
let pinhausHiwVisibleLayer = 0;
let pinhausHiwLoadToken = 0;

/** Mobile HIW: last step whose label finished animating. */
let pinhausHiwMobileDisplayedStep = null;
/** While non-null, a step label transition is in flight toward this step (prevents restart every tick). */
let pinhausHiwMobileCaptionAnimatingTo = null;
let pinhausHiwMobileCaptionToken = 0;
let pinhausHiwPrefetchStarted = false;

function prefetchPinhausHiwFrames() {
  if (pinhausHiwPrefetchStarted) {
    return;
  }
  pinhausHiwPrefetchStarted = true;
  PINHAUS_HIW_FRAME_SRCS.forEach((src) => {
    const img = new Image();
    img.decoding = "async";
    img.src = src;
  });
}

function pinhausHiwGetStepLabel(root, step) {
  const li = root.querySelector(
    `.pinhaus-hiw-item[data-hiw-step="${Number(step)}"]`
  );
  const btn = li?.querySelector(".pinhaus-hiw-btn");
  return (btn?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function pinhausHiwClearMobileCaptionAnim(wrap) {
  wrap.classList.remove(
    "pinhaus-hiw-mobile-caption--exit-left",
    "pinhaus-hiw-mobile-caption--exit-right",
    "pinhaus-hiw-mobile-caption--in-left",
    "pinhaus-hiw-mobile-caption--in-right"
  );
}

function pinhausHiwFillDotsHost(host, highlightedStep, flat) {
  if (!host) {
    return;
  }

  const sd = PINHAUS_HIW_STEPS[highlightedStep];
  const flatCount = Math.max(1, sd?.flatCount ?? 1);
  const flatStart = sd?.flatStart ?? 0;
  const aligned = pinhausHiwFlatIndexToStep(flat) === highlightedStep;
  let currentIdx = -1;
  if (flatCount === 1) {
    currentIdx = aligned ? 0 : -1;
  } else if (aligned) {
    currentIdx = Math.max(
      0,
      Math.min(flatCount - 1, flat - flatStart)
    );
  }

  if (
    host.dataset.hiwDotsStep === String(highlightedStep) &&
    host.dataset.hiwDotsCount === String(flatCount) &&
    host.dataset.hiwDotsCur === String(currentIdx)
  ) {
    return;
  }

  host.dataset.hiwDotsStep = String(highlightedStep);
  host.dataset.hiwDotsCount = String(flatCount);
  host.dataset.hiwDotsCur = String(currentIdx);

  host.replaceChildren();
  for (let i = 0; i < flatCount; i += 1) {
    const d = document.createElement("span");
    d.className = "pinhaus-hiw-dot";
    if (i === currentIdx) {
      d.classList.add("is-current");
    }
    host.append(d);
  }
}

function pinhausHiwClearDotsHost(host) {
  if (!host) {
    return;
  }
  host.replaceChildren();
  host.hidden = false;
  delete host.dataset.hiwDotsStep;
  delete host.dataset.hiwDotsCount;
  delete host.dataset.hiwDotsCur;
}

function updatePinhausHiwMobileDots(root, highlightedStep, flat, isMobile) {
  const host = root.querySelector("[data-hiw-mobile-dots]");
  if (!host) {
    return;
  }
  if (!isMobile) {
    pinhausHiwClearDotsHost(host);
    return;
  }

  host.hidden = false;
  pinhausHiwFillDotsHost(host, highlightedStep, flat);
}

function updatePinhausHiwMobileCaption(
  root,
  highlightedStep,
  isMobile,
  motionOk
) {
  const wrap = root.querySelector("[data-hiw-mobile-label]");
  const inner = wrap?.querySelector(".pinhaus-hiw-mobile-caption__text");
  if (!wrap || !inner) {
    return;
  }

  if (!isMobile) {
    pinhausHiwMobileCaptionToken += 1;
    pinhausHiwMobileDisplayedStep = null;
    pinhausHiwMobileCaptionAnimatingTo = null;
    pinhausHiwClearMobileCaptionAnim(wrap);
    inner.style.removeProperty("transform");
    inner.style.removeProperty("opacity");
    return;
  }

  if (pinhausHiwMobileDisplayedStep === null) {
    pinhausHiwClearMobileCaptionAnim(wrap);
    inner.textContent = pinhausHiwGetStepLabel(root, highlightedStep);
    pinhausHiwMobileDisplayedStep = highlightedStep;
    pinhausHiwMobileCaptionAnimatingTo = null;
    return;
  }

  if (pinhausHiwMobileCaptionAnimatingTo !== null) {
    if (highlightedStep === pinhausHiwMobileCaptionAnimatingTo) {
      return;
    }
    pinhausHiwMobileCaptionToken += 1;
    pinhausHiwMobileCaptionAnimatingTo = null;
    pinhausHiwClearMobileCaptionAnim(wrap);
    inner.style.setProperty("transition", "none");
    inner.textContent = pinhausHiwGetStepLabel(
      root,
      pinhausHiwMobileDisplayedStep
    );
    inner.style.removeProperty("transform");
    inner.style.removeProperty("opacity");
    void inner.offsetWidth;
    inner.style.removeProperty("transition");
  }

  if (highlightedStep === pinhausHiwMobileDisplayedStep) {
    return;
  }

  const fromStep = pinhausHiwMobileDisplayedStep;
  const toStep = highlightedStep;

  if (!motionOk) {
    pinhausHiwMobileCaptionToken += 1;
    pinhausHiwMobileCaptionAnimatingTo = null;
    pinhausHiwClearMobileCaptionAnim(wrap);
    inner.textContent = pinhausHiwGetStepLabel(root, toStep);
    pinhausHiwMobileDisplayedStep = toStep;
    return;
  }

  pinhausHiwMobileCaptionAnimatingTo = toStep;
  pinhausHiwMobileCaptionToken += 1;
  const myToken = pinhausHiwMobileCaptionToken;
  pinhausHiwClearMobileCaptionAnim(wrap);
  inner.textContent = pinhausHiwGetStepLabel(root, fromStep);
  inner.style.removeProperty("transform");
  inner.style.removeProperty("opacity");

  const goingDown = toStep > fromStep;
  const exitCls = goingDown
    ? "pinhaus-hiw-mobile-caption--exit-left"
    : "pinhaus-hiw-mobile-caption--exit-right";
  const enterCls = goingDown
    ? "pinhaus-hiw-mobile-caption--in-right"
    : "pinhaus-hiw-mobile-caption--in-left";

  void inner.offsetWidth;
  wrap.classList.add(exitCls);

  const onExitTE = (ev) => {
    if (myToken !== pinhausHiwMobileCaptionToken) {
      inner.removeEventListener("transitionend", onExitTE);
      pinhausHiwMobileCaptionAnimatingTo = null;
      pinhausHiwClearMobileCaptionAnim(wrap);
      inner.style.removeProperty("transform");
      inner.style.removeProperty("opacity");
      return;
    }
    if (ev.propertyName !== "transform") {
      return;
    }
    inner.removeEventListener("transitionend", onExitTE);
    inner.style.setProperty("transition", "none");
    wrap.classList.remove(exitCls);
    inner.textContent = pinhausHiwGetStepLabel(root, toStep);
    inner.style.removeProperty("transform");
    inner.style.removeProperty("opacity");
    void inner.offsetWidth;
    inner.style.removeProperty("transition");
    wrap.classList.add(enterCls);
    const onEnterAE = () => {
      inner.removeEventListener("animationend", onEnterAE);
      if (myToken !== pinhausHiwMobileCaptionToken) {
        pinhausHiwMobileCaptionAnimatingTo = null;
        pinhausHiwClearMobileCaptionAnim(wrap);
        return;
      }
      wrap.classList.remove(enterCls);
      pinhausHiwMobileDisplayedStep = toStep;
      pinhausHiwMobileCaptionAnimatingTo = null;
    };
    inner.addEventListener("animationend", onEnterAE, { once: true });
  };

  inner.addEventListener("transitionend", onExitTE);
}

function pinhausHiwSetCaption(root, flat) {
  const cap = root.querySelector("[data-hiw-caption]");
  if (cap) {
    cap.textContent = PINHAUS_HIW_FRAME_ALTS[flat] || "";
  }
}

function pinhausHiwApplyFrame(root, flat) {
  const visual = root.querySelector("[data-hiw-visual]");
  if (!visual) {
    return;
  }

  const layers = [...visual.querySelectorAll("[data-hiw-layer]")];
  if (layers.length < 2) {
    return;
  }

  const nextSrc = PINHAUS_HIW_FRAME_SRCS[flat];
  pinhausHiwSetCaption(root, flat);

  const front = layers[pinhausHiwVisibleLayer];
  const back = layers[1 - pinhausHiwVisibleLayer];

  if (
    front.classList.contains("is-visible") &&
    front.getAttribute("src") === nextSrc
  ) {
    return;
  }

  if (back.getAttribute("src") === nextSrc) {
    front.classList.remove("is-visible");
    back.classList.add("is-visible");
    pinhausHiwVisibleLayer = 1 - pinhausHiwVisibleLayer;
    return;
  }

  const token = ++pinhausHiwLoadToken;
  let didSwap = false;

  const onLoad = () => {
    back.removeEventListener("load", onLoad);
    back.removeEventListener("error", onError);
    if (didSwap || token !== pinhausHiwLoadToken) {
      return;
    }
    didSwap = true;
    front.classList.remove("is-visible");
    back.classList.add("is-visible");
    pinhausHiwVisibleLayer = 1 - pinhausHiwVisibleLayer;
  };

  const onError = () => {
    back.removeEventListener("load", onLoad);
    back.removeEventListener("error", onError);
  };

  back.addEventListener("load", onLoad);
  back.addEventListener("error", onError);
  back.setAttribute("src", nextSrc);
  back.setAttribute("alt", "");

  if (back.complete && back.naturalWidth > 0) {
    onLoad();
  }
}

function hiwRectOverlap(a, b) {
  return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
}

/** TL: vertex outside photo top-left; arms open down + right (east + south). */
function hiwTLCornerSERaysOverlapPhoto(vx, vy, armL, pr, stroke = 5) {
  const half = stroke / 2;
  const hSeg = {
    left: vx,
    top: vy - half,
    right: vx + armL,
    bottom: vy + half,
  };
  const vSeg = {
    left: vx - half,
    top: vy,
    right: vx + half,
    bottom: vy + armL,
  };
  return hiwRectOverlap(hSeg, pr) || hiwRectOverlap(vSeg, pr);
}

/** BR: vertex outside photo bottom-right; arms open up + left (west + north). */
function hiwBRCornerWNRaysOverlapPhoto(vx, vy, armL, pr, stroke = 5) {
  const half = stroke / 2;
  const hSeg = {
    left: vx - armL,
    top: vy - half,
    right: vx,
    bottom: vy + half,
  };
  const vSeg = {
    left: vx - half,
    top: vy - armL,
    right: vx + half,
    bottom: vy,
  };
  return hiwRectOverlap(hSeg, pr) || hiwRectOverlap(vSeg, pr);
}

function pinhausHowItWorksSectionVisible() {
  const sec = document.getElementById("pinhaus-how-it-works");
  if (!sec) {
    return false;
  }
  const r = sec.getBoundingClientRect();
  const vh = window.innerHeight;
  return r.bottom > 2 && r.top < vh - 2;
}

/** Viewport L-brackets: equal arms, offset from photo by margin m(L); corners sit outside photo bbox. */
function updatePinhausHiwViewportDeco(root, photoRect) {
  const deco = root.querySelector(".pinhaus-hiw-deco");
  if (!deco) {
    return;
  }
  const narrow = window.matchMedia("(max-width: 720px)").matches;
  const sectionOn = pinhausHowItWorksSectionVisible();
  if (narrow || !sectionOn || !photoRect || photoRect.width < 4) {
    deco.classList.remove("is-visible");
    root.style.removeProperty("--hiw-deco-tl-arm-h");
    root.style.removeProperty("--hiw-deco-tl-arm-v");
    root.style.removeProperty("--hiw-deco-tl-y");
    root.style.removeProperty("--hiw-deco-tl-vertex-x");
    root.style.removeProperty("--hiw-deco-br-left");
    root.style.removeProperty("--hiw-deco-br-top");
    root.style.removeProperty("--hiw-deco-br-arm");
    return;
  }

  const prTight = {
    left: photoRect.left,
    top: photoRect.top,
    right: photoRect.right,
    bottom: photoRect.bottom,
  };
  const w = photoRect.width;
  const m = Math.round(Math.min(44, Math.max(10, 12 + Math.min(w, photoRect.height) * 0.05)));
  const viewW = window.innerWidth;
  const viewH = window.innerHeight;

  const h = photoRect.height;
  let L0 = Math.round(Math.min(120, Math.max(28, Math.min(w, h) * 0.12)));

  // Vertex tracks photo (same idea as BR). Avoid clamping Y to the header — that
  // viewport-locks the corner while the image scrolls, which feels "sticky".
  let vxTl = photoRect.left - m;
  let vyTl = photoRect.top - m;

  let vbrx = photoRect.right + m;
  let vbry = photoRect.bottom + m;
  vbrx = Math.min(viewW - 10, vbrx);
  vbry = Math.min(viewH - 10, vbry);

  let L = Math.min(
    L0,
    Math.max(8, viewW - vxTl - 8),
    Math.max(8, viewH - vyTl - 8),
    Math.max(8, vbrx - 8),
    Math.max(8, vbry - 8),
    m > 6 ? Math.max(8, m - 2) : L0
  );
  L = Math.max(8, L);

  for (let i = 0; i < 56; i += 1) {
    const ok =
      !hiwTLCornerSERaysOverlapPhoto(vxTl, vyTl, L, prTight) &&
      !hiwBRCornerWNRaysOverlapPhoto(vbrx, vbry, L, prTight);
    if (ok) {
      break;
    }
    L = Math.max(8, L - 4);
  }

  root.style.setProperty("--hiw-deco-tl-vertex-x", `${Math.round(vxTl)}px`);
  root.style.setProperty("--hiw-deco-tl-y", `${Math.round(vyTl)}px`);
  root.style.setProperty("--hiw-deco-tl-arm-h", `${Math.round(L)}px`);
  root.style.setProperty("--hiw-deco-tl-arm-v", `${Math.round(L)}px`);

  const brLeft = Math.round(vbrx - L);
  const brTop = Math.round(vbry - L);
  root.style.setProperty("--hiw-deco-br-left", `${brLeft}px`);
  root.style.setProperty("--hiw-deco-br-top", `${brTop}px`);
  root.style.setProperty("--hiw-deco-br-arm", `${Math.round(L)}px`);
  deco.classList.add("is-visible");
}

/** Title strip width: inner left edge → visible image left (same band as connector line). */
function updatePinhausTitleRail(root) {
  const inner = root.querySelector(".pinhaus-hiw-inner");
  const visual = root.querySelector("[data-hiw-visual]");
  const nav = root.querySelector(".pinhaus-hiw-nav");
  if (!inner || !visual) {
    return;
  }

  if (window.matchMedia("(max-width: 720px)").matches) {
    inner.style.setProperty("--hiw-title-rail-px", "100%");
    inner.style.setProperty("--hiw-head-clearance", "0px");
    const works = root.querySelector(".pinhaus-key-features__word--works");
    if (works) {
      works.style.removeProperty("transform");
    }
    return;
  }

  const ir = inner.getBoundingClientRect();
  const frontImg =
    visual.querySelector(".pinhaus-hiw-layer.is-visible") ||
    visual.querySelector(".pinhaus-hiw-layer");
  const imgLeft =
    frontImg?.getBoundingClientRect()?.left ??
    visual.getBoundingClientRect().left;
  let railPx = Math.round(imgLeft - ir.left);
  if (!Number.isFinite(railPx) || railPx < 1) {
    railPx = Math.round(ir.width * 0.55);
  }

  const navW = nav ? Math.round(nav.getBoundingClientRect().width) : 0;
  const halfPx = window.innerWidth * 0.5;
  const halfMinusInner = Math.max(0, Math.ceil(halfPx - ir.left));
  const railQ = Math.round(Math.max(1, railPx) / 10) * 10;
  const baseW = Math.max(navW + 1, railQ, 80);
  const capW = Math.max(navW + 1, halfMinusInner, 80);
  const w =
    halfMinusInner > navW + 16
      ? Math.min(baseW, capW)
      : baseW;
  inner.style.setProperty("--hiw-title-rail-px", `${w}px`);

  const works = root.querySelector(".pinhaus-key-features__word--works");
  if (works) {
    works.style.removeProperty("transform");
  }

  const head = root.querySelector(".pinhaus-hiw-head");
  if (head) {
    requestAnimationFrame(() => {
      const h = Math.ceil(head.getBoundingClientRect().height);
      inner.style.setProperty("--hiw-head-clearance", `${Math.max(h + 10, 44)}px`);
    });
  }
}

function updatePinhausHowItWorks() {
  const root = pinhausHiwRoot;
  if (!root) {
    return;
  }

  const items = root.querySelectorAll(".pinhaus-hiw-item");
  const inner = root.querySelector(".pinhaus-hiw-inner");
  if (!items.length || !inner) {
    return;
  }

  const n = PINHAUS_HIW_FRAME_SRCS.length;
  const scrollP = pinhausHiwGetScrollProgress(root);
  let flat = 0;
  if (root.dataset.reducedMotion === "true") {
    flat = 0;
  } else {
    flat = Math.min(n - 1, Math.floor(scrollP * n));
    if (scrollP >= 1) {
      flat = n - 1;
    }
  }

  const activeFromScroll = pinhausHiwFlatIndexToStep(flat);
  const highlightedStep = activeFromScroll;

  pinhausHiwApplyFrame(root, flat);

  items.forEach((li) => {
    const step = Number(li.getAttribute("data-hiw-step"));
    const isOn = step === highlightedStep;
    li.classList.toggle("is-active", isOn);
    const b = li.querySelector(".pinhaus-hiw-btn");
    if (b) {
      b.setAttribute("aria-current", isOn ? "true" : "false");
    }
    const dots = li.querySelectorAll(".pinhaus-hiw-dot");
    if (dots.length) {
      const sd = PINHAUS_HIW_STEPS[step];
      const aligned = pinhausHiwFlatIndexToStep(flat) === step;
      let currentIdx = -1;
      if (isOn && aligned) {
        currentIdx = Math.max(0, Math.min(sd.flatCount - 1, flat - sd.flatStart));
      }
      dots.forEach((dot, idx) => {
        dot.classList.toggle("is-current", idx === currentIdx);
      });
    }
  });

  const isMobileHiw = window.matchMedia("(max-width: 720px)").matches;
  const motionOk =
    root.dataset.reducedMotion !== "true" && !prefersReducedMotion;
  updatePinhausHiwMobileCaption(
    root,
    highlightedStep,
    isMobileHiw,
    motionOk
  );
  updatePinhausHiwMobileDots(root, highlightedStep, flat, isMobileHiw);

  const stage = root.querySelector(".pinhaus-hiw-stage");
  const visual = root.querySelector("[data-hiw-visual]");

  if (!stage || !visual) {
    return;
  }

  if (isMobileHiw) {
    visual.style.removeProperty("transform");
  } else {
    const stR = stage.getBoundingClientRect();
    const photoNudge = Math.round(
      window.innerWidth * 0.75 - (stR.left + stR.right) / 2
    );
    visual.style.transform = `translateX(${photoNudge}px)`;
  }

  const frontForDeco =
    visual.querySelector(".pinhaus-hiw-layer.is-visible") ||
    visual.querySelector(".pinhaus-hiw-layer");
  const photoRectDeco = frontForDeco?.getBoundingClientRect() ?? null;
  updatePinhausHiwViewportDeco(root, photoRectDeco);

  requestAnimationFrame(() => {
    updatePinhausTitleRail(root);
  });

  const activeLi = root.querySelector(".pinhaus-hiw-item.is-active");
  const btn = activeLi?.querySelector(".pinhaus-hiw-btn");

  stage.style.setProperty("--hiw-line-opacity", "0");

  if (!btn) {
    return;
  }

  if (isMobileHiw) {
    return;
  }
}

function initPinhausHowItWorks() {
  pinhausHiwRoot = document.querySelector("[data-pinhaus-hiw]");
  if (!pinhausHiwRoot) {
    return;
  }
  prefetchPinhausHiwFrames();

  if (prefersReducedMotion) {
    pinhausHiwRoot.dataset.reducedMotion = "true";
  }

  pinhausHiwVisibleLayer = 0;
  pinhausHiwLoadToken = 0;

  pinhausHiwRoot.querySelectorAll(".pinhaus-hiw-item").forEach((li) => {
    if (li.querySelector(".pinhaus-hiw-item-row")) {
      return;
    }
    const btn = li.querySelector(".pinhaus-hiw-btn");
    if (!btn) {
      return;
    }
    const step = Number(li.getAttribute("data-hiw-step"));
    const row = document.createElement("div");
    row.className = "pinhaus-hiw-item-row";
    const dots = document.createElement("div");
    dots.className = "pinhaus-hiw-dots";
    dots.setAttribute("aria-hidden", "true");
    const count = PINHAUS_HIW_STEPS[step]?.flatCount ?? 1;
    for (let i = 0; i < count; i += 1) {
      const d = document.createElement("span");
      d.className = "pinhaus-hiw-dot";
      dots.append(d);
    }
    li.insertBefore(row, btn);
    row.append(btn, dots);
  });

  pinhausHiwRoot.querySelectorAll(".pinhaus-hiw-item .pinhaus-hiw-btn").forEach((btn) => {
    const li = btn.closest(".pinhaus-hiw-item");
    if (!li) {
      return;
    }
    btn.addEventListener("click", () => {
      const step = Number(li.getAttribute("data-hiw-step"));
      pinhausHiwScrollRootToStepStart(pinhausHiwRoot, step);
      updatePinhausHowItWorks();
      requestAnimationFrame(() => {
        updatePinhausHowItWorks();
        requestAnimationFrame(() => updatePinhausHowItWorks());
      });
    });
  });

  window.addEventListener("resize", updatePinhausHowItWorks, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", updatePinhausHowItWorks, {
      passive: true,
    });
  }
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => updatePinhausHowItWorks()).observe(pinhausHiwRoot);
  }

  updatePinhausHowItWorks();
}

function initEditorialCaseSolutionBandWidth() {
  const bands = document.querySelectorAll(
    "main.case-page--editorial .case-solution-stack__band"
  );
  if (!bands.length) {
    return;
  }
  const run = () => updateEditorialCaseSolutionBandWidth();
  run();
  requestAnimationFrame(() => requestAnimationFrame(run));
  window.addEventListener("resize", run, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", run, { passive: true });
  }
  if (typeof ResizeObserver !== "undefined") {
    bands.forEach((band) => {
      new ResizeObserver(run).observe(band);
    });
  }
  if (document.fonts?.ready) {
    document.fonts.ready.then(run);
  }
}

function initPinhausDesignCarousel() {
  const root = document.querySelector("[data-pinhaus-design-carousel]");
  if (!root) {
    return;
  }
  const track = root.querySelector(".pinhaus-design-carousel__track");
  const slides = [...root.querySelectorAll(".pinhaus-design-carousel__slide")];
  const prevBtn = root.querySelector("[data-design-carousel-prev]");
  const nextBtn = root.querySelector("[data-design-carousel-next]");
  const dotsHost = root.querySelector("[data-design-carousel-dots]");
  if (!track || slides.length === 0) {
    return;
  }

  if (prefersReducedMotion) {
    track.style.setProperty("transition", "none");
  }

  let idx = 0;
  const n = slides.length;
  const dotButtons = [];

  if (dotsHost) {
    dotsHost.replaceChildren();
    for (let i = 0; i < n; i += 1) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pinhaus-design-carousel__dot";
      b.setAttribute("aria-label", `Show image ${i + 1} of ${n}`);
      b.addEventListener("click", () => go(i));
      dotsHost.append(b);
      dotButtons.push(b);
    }
  }

  function sync() {
    track.style.transform = `translateX(-${idx * 100}%)`;
    slides.forEach((s, i) => {
      s.classList.toggle("is-active", i === idx);
    });
    dotButtons.forEach((b, i) => {
      b.classList.toggle("is-current", i === idx);
      if (i === idx) {
        b.setAttribute("aria-current", "true");
      } else {
        b.removeAttribute("aria-current");
      }
    });
  }

  function go(nextIdx) {
    idx = (nextIdx + n) % n;
    sync();
  }

  prevBtn?.addEventListener("click", () => go(idx - 1));
  nextBtn?.addEventListener("click", () => go(idx + 1));

  sync();
}

function initCaseStudyTocAnchors() {
  document.querySelectorAll(".case-hero-editorial__toc").forEach((nav) => {
    nav.addEventListener("click", (e) => {
      const link = e.target.closest('a[href^="#"]');
      if (!link || !nav.contains(link)) {
        return;
      }
      const raw = link.getAttribute("href");
      if (!raw || raw === "#" || raw.length < 2) {
        return;
      }
      const id = decodeURIComponent(raw.slice(1));
      const el = document.getElementById(id);
      if (!el) {
        return;
      }
      if (lenis) {
        e.preventDefault();
        lenis.scrollTo(el);
      }
    });
  });
}

function getScrollY() {
  return lenis ? lenis.scroll : window.scrollY;
}

function syncDocumentTheme() {
  const t = document.body.getAttribute("data-theme") || "light";
  document.documentElement.setAttribute("data-theme", t);
}

function updateScrollTheme() {
  if (!themeSections.length) {
    return;
  }

  const vh = window.innerHeight;
  const focalY = vh * 0.38;
  let best = null;
  let bestDist = Infinity;

  themeSections.forEach((section) => {
    const r = section.getBoundingClientRect();
    if (r.bottom <= 12 || r.top >= vh - 12) {
      return;
    }

    const center = r.top + Math.min(r.height * 0.35, r.height * 0.5);
    const dist = Math.abs(center - focalY);
    if (dist < bestDist) {
      bestDist = dist;
      best = section;
    }
  });

  const next = best?.getAttribute("data-theme") || "light";
  if (document.body.getAttribute("data-theme") !== next) {
    document.body.setAttribute("data-theme", next);
    document.documentElement.setAttribute("data-theme", next);
  }
}

function initChapterActiveStates() {
  const chapters = document.querySelectorAll("[data-sticky-chapter]");
  if (!chapters.length) {
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        entry.target.classList.toggle("is-chapter-active", entry.isIntersecting);
      });
    },
    {
      threshold: [0, 0.1, 0.25],
      rootMargin: prefersReducedMotion ? "0px" : "-12% 0px -28% 0px",
    }
  );

  chapters.forEach((el) => io.observe(el));
}

function initCaseCursorParallax() {
  const mqPhoneNoParallax = window.matchMedia("(max-width: 720px)");

  window.addEventListener(
    "resize",
    () => {
      if (mqPhoneNoParallax.matches) {
        document.querySelectorAll(".case-phone-mock__phones").forEach((el) => {
          el.style.removeProperty("transform");
        });
      }
    },
    { passive: true }
  );

  if (prefersReducedMotion) {
    return;
  }

  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    return;
  }

  if (mqPhoneNoParallax.matches) {
    return;
  }

  const roots = document.querySelectorAll("[data-cursor-parallax]");
  if (!roots.length) {
    return;
  }

  roots.forEach((root) => {
    const phones = root.querySelector(".case-phone-mock__phones");
    if (!phones) {
      return;
    }

    const base = Math.min(
      48,
      Math.max(8, parseFloat(root.getAttribute("data-cursor-parallax")) || 22)
    );
    const phoneScale = base * 0.42;

    let inView = false;

    const io = new IntersectionObserver(
      (entries) => {
        inView = entries.some((e) => e.isIntersecting);
        if (!inView) {
          phones.style.removeProperty("transform");
        }
      },
      { threshold: 0, rootMargin: "40px 0px 40px 0px" }
    );
    io.observe(root);

    const onMove = (e) => {
      if (mqPhoneNoParallax.matches) {
        phones.style.removeProperty("transform");
        return;
      }
      if (!inView) {
        return;
      }
      const r = root.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) {
        return;
      }
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const nx = (e.clientX - cx) / (r.width / 2);
      const ny = (e.clientY - cy) / (r.height / 2);
      const clamp = (v) => Math.max(-1, Math.min(1, v));
      const cnx = clamp(nx);
      const cny = clamp(ny);
      const px = -cnx * phoneScale;
      const py = -cny * phoneScale;
      phones.style.transform = `translate3d(${px.toFixed(2)}px, ${py.toFixed(2)}px, 0)`;
    };

    window.addEventListener("mousemove", onMove, { passive: true });
  });
}

function initMagnetic() {
  if (prefersReducedMotion) {
    return;
  }

  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    return;
  }

  const strength = 0.24;

  document.querySelectorAll("[data-magnetic]").forEach((el) => {
    el.addEventListener("mousemove", (e) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = (e.clientX - cx) * strength;
      const dy = (e.clientY - cy) * strength;
      el.style.transform = `translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0)`;
    });

    el.addEventListener("mouseleave", () => {
      el.style.transform = "";
    });
  });
}

function initProjectFolderIdleState() {
  const cards = document.querySelectorAll(".project-block");
  if (!cards.length) {
    return;
  }

  cards.forEach((card) => {
    const hit = card.querySelector(".project-block__media-hit");
    if (!hit) {
      return;
    }
    hit.addEventListener(
      "pointerdown",
      () => {
        card.classList.add("is-interacted");
      },
      { passive: true }
    );
  });
}

const revealElements = document.querySelectorAll(".reveal");
const siteHeader = document.querySelector(".site-header");
const isHomeHeader = siteHeader?.classList.contains("home-header");
let lastScrollY = getScrollY();

function handleRevealEntry(entry, observer) {
  if (!entry.isIntersecting) {
    return;
  }

  entry.target.classList.add("is-visible");
  observer.unobserve(entry.target);
}

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => handleRevealEntry(entry, revealObserver));
  },
  {
    threshold: 0.15,
    rootMargin: "0px 0px -8% 0px",
  }
);

const revealEagerObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => handleRevealEntry(entry, revealEagerObserver));
  },
  {
    threshold: 0.06,
    rootMargin: "0px 0px -2% 0px",
  }
);

revealElements.forEach((element) => {
  if (element.classList.contains("reveal--eager")) {
    revealEagerObserver.observe(element);
  } else {
    revealObserver.observe(element);
  }
});

/* IntersectionObserver can skip the first paint if elements are already in view; flush pending entries. */
revealObserver
  .takeRecords()
  .forEach((entry) => handleRevealEntry(entry, revealObserver));
revealEagerObserver
  .takeRecords()
  .forEach((entry) => handleRevealEntry(entry, revealEagerObserver));

const parallaxElements = document.querySelectorAll("[data-parallax]");
let parallaxTicking = false;

const updateParallax = () => {
  parallaxTicking = false;
  const viewportHeight = window.innerHeight;

  parallaxElements.forEach((element) => {
    const speed = Number(element.getAttribute("data-parallax")) || 0;
    if (!speed) {
      return;
    }

    const rect = element.getBoundingClientRect();
    const inView = rect.bottom > 0 && rect.top < viewportHeight;
    if (!inView) {
      return;
    }

    const distanceFromCenter = rect.top + rect.height / 2 - viewportHeight / 2;
    const translateY = distanceFromCenter * -speed;
    element.style.transform = `translate3d(0, ${translateY.toFixed(2)}px, 0)`;
  });
};

const requestParallaxUpdate = () => {
  if (parallaxTicking) {
    return;
  }
  parallaxTicking = true;
  window.requestAnimationFrame(updateParallax);
};

function updateHeaderState() {
  if (!siteHeader) {
    return;
  }

  const currentScrollY = getScrollY();

  if (isHomeHeader) {
    const isScrollingDown = currentScrollY > lastScrollY;
    if (currentScrollY > 70 && isScrollingDown) {
      siteHeader.classList.add("is-hidden");
    } else {
      siteHeader.classList.remove("is-hidden");
    }
    lastScrollY = currentScrollY;
    return;
  }

  if (currentScrollY > 40) {
    siteHeader.classList.add("is-condensed");
  } else {
    siteHeader.classList.remove("is-condensed");
  }
}

function updatePinhausHiwHeaderProgress() {
  const header = document.querySelector(".site-header");
  if (!header || !pinhausHiwRoot || prefersReducedMotion) {
    pinhausHiwHeaderProgressTarget = 0;
    pinhausHiwHeaderProgressDisplayed = 0;
    if (pinhausHiwHeaderProgressRaf) {
      cancelAnimationFrame(pinhausHiwHeaderProgressRaf);
      pinhausHiwHeaderProgressRaf = 0;
    }
    if (header) {
      header.classList.remove("pinhaus-hiw-progress-active");
    }
    document.documentElement.style.removeProperty(
      "--pinhaus-hiw-header-progress"
    );
    return;
  }

  const root = pinhausHiwRoot;
  const rect = root.getBoundingClientRect();
  const inRange = rect.top < window.innerHeight && rect.bottom > 0;
  const scrollP = pinhausHiwGetScrollProgress(root);
  pinhausHiwHeaderProgressTarget = inRange ? scrollP : 0;

  const animate = () => {
    const activeHeader = document.querySelector(".site-header");
    if (!activeHeader || prefersReducedMotion) {
      pinhausHiwHeaderProgressRaf = 0;
      return;
    }
    const delta = pinhausHiwHeaderProgressTarget - pinhausHiwHeaderProgressDisplayed;
    pinhausHiwHeaderProgressDisplayed += delta * 0.24;
    if (Math.abs(delta) < 0.0015) {
      pinhausHiwHeaderProgressDisplayed = pinhausHiwHeaderProgressTarget;
    }
    document.documentElement.style.setProperty(
      "--pinhaus-hiw-header-progress",
      String(pinhausHiwHeaderProgressDisplayed)
    );
    const stillActive =
      pinhausHiwHeaderProgressDisplayed > 0.001 ||
      pinhausHiwHeaderProgressTarget > 0.001;
    activeHeader.classList.toggle("pinhaus-hiw-progress-active", stillActive);
    if (Math.abs(pinhausHiwHeaderProgressTarget - pinhausHiwHeaderProgressDisplayed) > 0.001) {
      pinhausHiwHeaderProgressRaf = requestAnimationFrame(animate);
    } else {
      pinhausHiwHeaderProgressRaf = 0;
    }
  };

  if (!pinhausHiwHeaderProgressRaf) {
    pinhausHiwHeaderProgressRaf = requestAnimationFrame(animate);
  }
}

function updateScrollProgress() {
  if (!scrollProgressEl || prefersReducedMotion) {
    return;
  }

  if (pinhausHiwRoot) {
    scrollProgressEl.style.transform = "scaleX(0)";
    return;
  }

  const maxScroll = Math.max(
    1,
    document.documentElement.scrollHeight - window.innerHeight
  );
  const p = Math.min(1, Math.max(0, getScrollY() / maxScroll));
  scrollProgressEl.style.transform = `scaleX(${p})`;
}

/** Stronger than cubic: more travel in the middle of the scroll range (fast “feed fling”). */
function easeInOutQuint(t) {
  return t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;
}

function clearBandhouseIMessageTimers() {
  while (bandhouseIMsgTimers.length) {
    const id = bandhouseIMsgTimers.pop();
    window.clearTimeout(id);
  }
}

function resetBandhouseIMessage(root) {
  clearBandhouseIMessageTimers();
  const panel = root?.querySelector("[data-bandhouse-imessage]");
  if (!panel) {
    return;
  }
  panel.querySelectorAll("[data-imsg-step]").forEach((row) => {
    row.classList.remove("is-visible", "is-hiding");
  });
}

function clearBandhouseHoldChoreo(root) {
  while (bandhouseHoldTimers.length) {
    window.clearTimeout(bandhouseHoldTimers.pop());
  }
  if (!root) {
    return;
  }
  root.classList.remove("is-finale-sub-on");
  root.classList.remove("is-finale-bridge-on");
  delete root.dataset.bhHoldChoreo;
  bandhouseIMsgStarted = false;
  resetBandhouseIMessage(root);
}

/** Flat “dwell” on the black IG tile: same feed position while document scroll advances (~0.5s feel). */
function bandhouseRawToHoldRatio(rawP, travel, holdRatio = 0.82) {
  const dwellFrac = Math.min(0.19, 700 / Math.max(travel, 420));
  const s1 = Math.min(0.997, BH_IG_DWELL_START + dwellFrac);
  const held = Math.min(0.995, Math.max(0.2, holdRatio));
  const startNorm = Math.max(0.001, BH_IG_DWELL_START);
  if (rawP <= BH_IG_DWELL_START) {
    const n = Math.min(1, Math.max(0, rawP / startNorm));
    return easeInOutQuint(n) * held;
  }
  if (rawP < s1) {
    return held;
  }
  const t = Math.min(1, Math.max(0, (rawP - s1) / Math.max(0.001, 1 - s1)));
  return held + (1 - held) * easeInOutQuint(t);
}

function bandhouseHoldChoreoStillValid(root, rootTop, travel) {
  if (!root) {
    return false;
  }
  const p = Math.min(
    1,
    Math.max(0, (getScrollY() - rootTop) / Math.max(1, travel))
  );
  return p >= BH_IG_DWELL_START - 0.018;
}

function armBandhouseHoldChoreo(root, rootTop, travel) {
  if (root.dataset.bhHoldChoreo === "1") {
    return;
  }
  root.dataset.bhHoldChoreo = "1";

  bandhouseHoldTimers.push(
    window.setTimeout(() => {
      if (!bandhouseHoldChoreoStillValid(root, rootTop, travel)) {
        return;
      }
      root.classList.add("is-finale-sub-on");
    }, 0)
  );

  bandhouseHoldTimers.push(
    window.setTimeout(() => {
      if (!bandhouseHoldChoreoStillValid(root, rootTop, travel)) {
        return;
      }
      root.classList.add("is-finale-bridge-on");
    }, 980)
  );

  bandhouseHoldTimers.push(
    window.setTimeout(() => {
      if (!bandhouseHoldChoreoStillValid(root, rootTop, travel)) {
        return;
      }
      if (!bandhouseIMsgStarted) {
        bandhouseIMsgStarted = true;
        startBandhouseIMessageSequence(root);
      }
    }, 1280)
  );
}

/** Timed iOS-style thread: out, out, typing, pause, idk. Replays when scroll leaves then returns. */
function startBandhouseIMessageSequence(root) {
  const panel = root.querySelector("[data-bandhouse-imessage]");
  if (!panel) {
    return;
  }
  resetBandhouseIMessage(root);

  const row = (n) => panel.querySelector(`[data-imsg-step="${n}"]`);

  bandhouseIMsgTimers.push(
    window.setTimeout(() => row(1)?.classList.add("is-visible"), 140)
  );
  bandhouseIMsgTimers.push(
    window.setTimeout(() => row(2)?.classList.add("is-visible"), 820)
  );
  bandhouseIMsgTimers.push(
    window.setTimeout(() => row(3)?.classList.add("is-visible"), 1720)
  );
  bandhouseIMsgTimers.push(
    window.setTimeout(() => row(3)?.classList.add("is-hiding"), 3400)
  );
  bandhouseIMsgTimers.push(
    window.setTimeout(() => {
      row(3)?.classList.remove("is-visible", "is-hiding");
    }, 3740)
  );
  bandhouseIMsgTimers.push(
    window.setTimeout(() => row(4)?.classList.add("is-visible"), 4480)
  );
}

function formatBandhouseCount(n) {
  if (n >= 1000) {
    const rounded = Math.round((n / 1000) * 10) / 10;
    return `${rounded}k`;
  }
  return String(n);
}

function initBandhouseIgPostChrome(root) {
  const posts = root.querySelectorAll(".bandhouse-ig-problem__track .bandhouse-ig-problem__post");
  const captions = [
    "show in a month!",
    "show in 3 weeks!",
    "show in 2 weeks!",
    "show next week!",
    "show this week!",
    "show tonight!"
  ];
  const ageSteps = ["20h", "2d", "3d", "5d", "8d", "12d", "16d", "22d", "1mo"];
  const lastIdx = Math.max(1, posts.length - 1);

  posts.forEach((post, idx) => {
    if (post.dataset.igUiReady === "1") {
      return;
    }
    post.dataset.igUiReady = "1";
    post.classList.add("is-ig-ui-post");

    const head = post.querySelector(".bandhouse-ig-problem__post-head");
    const meta = head?.querySelector(".bandhouse-ig-problem__post-meta");
    if (head && meta) {
      meta.replaceChildren();
      const user = document.createElement("span");
      user.className = "bandhouse-ig-problem__user";
      user.textContent = "ShowsNearU";
      const time = document.createElement("span");
      time.className = "bandhouse-ig-problem__time";
      const ageIdx = Math.min(
        ageSteps.length - 1,
        Math.floor((idx / lastIdx) * (ageSteps.length - 1))
      );
      time.textContent = ageSteps[ageIdx];
      meta.append(user, time);

      const menu = document.createElement("button");
      menu.type = "button";
      menu.className = "bandhouse-ig-problem__menu";
      menu.textContent = "•••";
      menu.setAttribute("aria-label", "More post options");
      head.append(menu);
    }

    const footer = post.querySelector(".bandhouse-ig-problem__post-foot");
    if (!footer) {
      return;
    }
    const likes = 930 + ((idx * 137) % 710);
    const reposts = likes - 35 + ((idx * 19) % 85);
    const comments = 8 + ((idx * 7) % 36);

    footer.replaceChildren();

    const actions = document.createElement("div");
    actions.className = "bandhouse-ig-problem__actions";

    const actionLike = document.createElement("span");
    actionLike.className = "bandhouse-ig-problem__action";
    actionLike.textContent = `♡ ${formatBandhouseCount(likes)}`;
    const actionComment = document.createElement("span");
    actionComment.className = "bandhouse-ig-problem__action";
    actionComment.textContent = `💬 ${comments}`;
    const actionRepost = document.createElement("span");
    actionRepost.className = "bandhouse-ig-problem__action";
    actionRepost.textContent = `↻ ${formatBandhouseCount(reposts)}`;
    const actionSend = document.createElement("span");
    actionSend.className = "bandhouse-ig-problem__action";
    actionSend.textContent = "✈";

    actions.append(actionLike, actionComment, actionRepost, actionSend);

    const caption = document.createElement("p");
    caption.className = "bandhouse-ig-problem__caption";
    const captionUser = document.createElement("strong");
    captionUser.textContent = "ShowsNearU";
    caption.append(captionUser, ` ${captions[idx % captions.length]}`);

    footer.append(actions, caption);
  });
}

function initBandhouseStaggerCopy(root) {
  const nodes = root.querySelectorAll("[data-bandhouse-stagger]");
  nodes.forEach((el) => {
    if (el.dataset.staggerReady === "1") {
      return;
    }
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!text) {
      return;
    }
    const words = text.split(" ");
    el.replaceChildren();
    words.forEach((word, idx) => {
      const span = document.createElement("span");
      span.className = "bandhouse-ig-problem__stagger-word";
      span.style.setProperty("--w", String(idx));
      span.textContent = word;
      el.append(span);
      if (idx < words.length - 1) {
        el.append(document.createTextNode(" "));
      }
    });
    el.dataset.staggerReady = "1";
  });
}

function updateBandhouseProofRows() {
  if (!bandhouseStatRows.length || prefersReducedMotion) {
    return;
  }
  const vh = window.innerHeight;
  bandhouseStatRows.forEach((row) => {
    const rect = row.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (vh - rect.top) / (vh + rect.height)));
    const dir = row.dataset.bandhouseStatDir === "left" ? -1 : 1;
    const shift = dir * (p - 0.5) * 86;
    row.style.setProperty("--bandhouse-stat-shift", `${shift.toFixed(2)}px`);
  });
}

/** BandHouse “THE PROBLEM”: scroll-scrubbed faux feed (symmetric up / down with page scroll). */
function updateBandhouseIgProblem() {
  const root = bandhouseIgProblemRoot;
  if (!root || prefersReducedMotion) {
    return;
  }

  const track = root.querySelector("[data-bandhouse-ig-track]");
  const viewport = root.querySelector("[data-bandhouse-ig-viewport]");
  if (!track || !viewport) {
    return;
  }

  const rect = root.getBoundingClientRect();
  const vh = window.innerHeight;
  if (rect.bottom < -80 || rect.top > vh + 120) {
    bandhouseIgLastRatio = -1;
    clearBandhouseHoldChoreo(root);
    return;
  }

  const scrollY = getScrollY();
  const rootTop = rect.top + scrollY;
  const travel = Math.max(1, root.offsetHeight - vh);
  const rawP = Math.min(1, Math.max(0, (scrollY - rootTop) / travel));
  const maxTy = Math.max(0, track.scrollHeight - viewport.clientHeight);
  const finale = track.querySelector(".bandhouse-ig-problem__post--finale");
  const finaleTop = finale ? finale.offsetTop : maxTy;
  const finaleBottom = finale
    ? finale.offsetTop + finale.offsetHeight
    : maxTy + viewport.clientHeight;
  const topbarH = root.querySelector(".bandhouse-ig-problem__ig-topbar")?.offsetHeight ?? 0;
  const visibleTop = topbarH;
  const visibleBottom = viewport.clientHeight;
  const minTyForBottom = finaleBottom - visibleBottom;
  const maxTyForTop = finaleTop - visibleTop;
  // Bias to bottom alignment so actions/caption never clip below the text area.
  let holdTy = minTyForBottom;
  if (minTyForBottom > maxTyForTop) {
    // If full fit is impossible, keep the card as low as possible.
    holdTy = minTyForBottom;
  }
  holdTy = Math.min(maxTy, Math.max(0, holdTy));
  const holdRatio = maxTy > 0 ? holdTy / maxTy : 1;
  const ratio = bandhouseRawToHoldRatio(rawP, travel, holdRatio);

  if (rawP >= BH_IG_DWELL_START) {
    armBandhouseHoldChoreo(root, rootTop, travel);
  } else if (rawP < BH_IG_DWELL_START - 0.045) {
    clearBandhouseHoldChoreo(root);
  }

  const ty = -maxTy * ratio;
  track.style.transform = `translate3d(0, ${ty}px, 0)`;

  if (bandhouseIgLastRatio >= 0) {
    const speed = Math.abs(ratio - bandhouseIgLastRatio);
    if (speed > 0.012) {
      root.classList.add("is-scrubbing");
      window.clearTimeout(bandhouseIgScrubTimer);
      bandhouseIgScrubTimer = window.setTimeout(() => {
        root.classList.remove("is-scrubbing");
      }, 140);
    }
  }
  bandhouseIgLastRatio = ratio;
}

function initBandhouseIgProblem() {
  bandhouseIgProblemRoot = document.querySelector("[data-bandhouse-ig-problem]");
  if (!bandhouseIgProblemRoot) {
    return;
  }

  const viewport = bandhouseIgProblemRoot.querySelector("[data-bandhouse-ig-viewport]");
  initBandhouseIgPostChrome(bandhouseIgProblemRoot);
  initBandhouseStaggerCopy(bandhouseIgProblemRoot);
  updateBandhouseIgProblem();
  window.requestAnimationFrame(() =>
    window.requestAnimationFrame(updateBandhouseIgProblem)
  );

  const schedule = () => {
    window.requestAnimationFrame(updateBandhouseIgProblem);
  };
  window.addEventListener("resize", schedule, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", schedule, { passive: true });
  }
  if (document.fonts?.ready) {
    document.fonts.ready.then(updateBandhouseIgProblem);
  }
  if (typeof ResizeObserver !== "undefined" && viewport) {
    new ResizeObserver(updateBandhouseIgProblem).observe(viewport);
    new ResizeObserver(updateBandhouseIgProblem).observe(
      bandhouseIgProblemRoot.querySelector("[data-bandhouse-ig-track]") ?? viewport
    );
  }
}

function initBandhouseProofRows() {
  bandhouseStatRows = [...document.querySelectorAll("[data-bandhouse-stat-row]")];
  updateBandhouseProofRows();
}

function updateBandhouseSolutionFeed() {
  const root = bandhouseSolutionFeedRoot;
  if (!root || prefersReducedMotion) {
    return;
  }
  const track = root.querySelector("[data-bandhouse-solution-track]");
  const viewport = root.querySelector("[data-bandhouse-solution-viewport]");
  if (!track || !viewport) {
    return;
  }
  const rect = root.getBoundingClientRect();
  const vh = window.innerHeight;
  if (rect.bottom < -100 || rect.top > vh + 120) {
    return;
  }
  const scrollY = getScrollY();
  const rootTop = rect.top + scrollY;
  const travel = Math.max(1, root.offsetHeight - vh);
  const raw = Math.min(1, Math.max(0, (scrollY - rootTop) / travel));
  const ratio = easeInOutQuint(raw);
  const maxTy = Math.max(0, track.scrollHeight - viewport.clientHeight);
  track.style.transform = `translate3d(0, ${(-maxTy * ratio).toFixed(2)}px, 0)`;
}

function initBandhouseSolutionFeed() {
  bandhouseSolutionFeedRoot = document.querySelector("[data-bandhouse-solution-feed]");
  if (!bandhouseSolutionFeedRoot) {
    return;
  }
  initBandhouseStaggerCopy(
    bandhouseSolutionFeedRoot.closest("section") ?? bandhouseSolutionFeedRoot
  );
  const after = bandhouseSolutionFeedRoot.parentElement?.querySelector(
    ".bandhouse-solution-feed__after"
  );
  const mapRow = after?.querySelector(".bandhouse-solution-feed__map-row");
  if (after && mapRow && typeof IntersectionObserver !== "undefined") {
    const copyIo = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          after.classList.toggle("is-map-copy-visible", entry.isIntersecting);
        });
      },
      { threshold: 0.06, rootMargin: "0px 0px 6% 0px" }
    );
    copyIo.observe(mapRow);
    const mapIo = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          after.classList.toggle("is-map-row-visible", entry.isIntersecting);
        });
      },
      { threshold: 0.2, rootMargin: "0px 0px -12% 0px" }
    );
    mapIo.observe(mapRow);
  } else if (after) {
    after.classList.add("is-map-copy-visible");
    after.classList.add("is-map-row-visible");
  }
  updateBandhouseSolutionFeed();
  window.requestAnimationFrame(() =>
    window.requestAnimationFrame(updateBandhouseSolutionFeed)
  );
}

function onScroll() {
  updateHeaderState();
  updateScrollProgress();
  updatePinhausHiwHeaderProgress();
  updateScrollTheme();
  updatePinhausHowItWorks();
  updateBandhouseIgProblem();
  updateBandhouseSolutionFeed();
  updateBandhouseProofRows();
  if (parallaxElements.length) {
    requestParallaxUpdate();
  }
}

if (!prefersReducedMotion) {
  document.documentElement.classList.add("split-lines-enhanced");
  const splitObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }
        entry.target.classList.add("is-inview");
        splitObserver.unobserve(entry.target);
      });
    },
    {
      threshold: 0.2,
      rootMargin: "0px 0px -6% 0px",
    }
  );

  splitHeadingEls.forEach((element) => splitObserver.observe(element));
  splitObserver
    .takeRecords()
    .forEach((entry) => {
      if (!entry.isIntersecting) {
        return;
      }
      entry.target.classList.add("is-inview");
      splitObserver.unobserve(entry.target);
    });
} else {
  splitHeadingEls.forEach((element) => element.classList.add("is-inview"));
}

if (!prefersReducedMotion && typeof Lenis !== "undefined") {
  document.documentElement.classList.add("lenis");
  lenis = new Lenis({
    smoothWheel: true,
    syncTouch: true,
    touchMultiplier: 1.65,
  });

  function lenisRaf(time) {
    lenis.raf(time);
    requestAnimationFrame(lenisRaf);
  }

  requestAnimationFrame(lenisRaf);
  lenis.on("scroll", onScroll);
} else {
  window.addEventListener("scroll", onScroll, { passive: true });
}

initCaseStudyTocAnchors();
initCaseHeroTocGuideLines();
initEditorialCaseSolutionBandWidth();
initBandhouseIgProblem();
initBandhouseSolutionFeed();
initBandhouseProofRows();
initPinhausHowItWorks();
initPinhausDesignCarousel();

syncDocumentTheme();
updateHeaderState();
updateScrollProgress();
updatePinhausHiwHeaderProgress();
updateBandhouseIgProblem();
updateBandhouseSolutionFeed();
updateBandhouseProofRows();
updateScrollTheme();
initChapterActiveStates();
initCaseCursorParallax();
initMagnetic();
initProjectFolderIdleState();

if (parallaxElements.length) {
  updateParallax();
  window.addEventListener("resize", requestParallaxUpdate, { passive: true });
}

window.addEventListener("resize", () => {
  updateScrollProgress();
  updatePinhausHiwHeaderProgress();
  updateBandhouseIgProblem();
  updateBandhouseSolutionFeed();
  updateBandhouseProofRows();
}, { passive: true });
