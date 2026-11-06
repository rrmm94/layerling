"use client";
import { useEffect } from "react";
import { isTouchFirst } from "@/lib/touchFirst";

/** Safari's layout viewport does not shrink with its keyboard. Follow the visible area instead. */
export function watchClassroomViewport() {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  const names = ["--classroom-visual-height", "--classroom-visual-top"] as const;
  const previous = names.map(name => root.style.getPropertyValue(name));
  const previousTouch = root.dataset.classroomTouch;
  root.dataset.classroomTouch = String(isTouchFirst({
    coarse: window.matchMedia("(pointer: coarse)").matches,
    hoverNone: window.matchMedia("(hover: none)").matches,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
  }));
  const update = () => {
    // Browser zoom must remain accessible; don't reflow the app while someone magnifies it.
    if (viewport && Math.abs(viewport.scale - 1) > 0.05) return;
    root.style.setProperty(names[0], `${Math.round(viewport?.height ?? window.innerHeight)}px`);
    root.style.setProperty(names[1], `${Math.round(viewport?.offsetTop ?? 0)}px`);
  };
  update();
  viewport?.addEventListener("resize", update);
  viewport?.addEventListener("scroll", update);
  window.addEventListener("resize", update);
  return () => {
    viewport?.removeEventListener("resize", update);
    viewport?.removeEventListener("scroll", update);
    window.removeEventListener("resize", update);
    names.forEach((name, i) => previous[i] ? root.style.setProperty(name, previous[i]) : root.style.removeProperty(name));
    if (previousTouch === undefined) delete root.dataset.classroomTouch;
    else root.dataset.classroomTouch = previousTouch;
  };
}
export function useClassroomViewport(active: boolean) {
  useEffect(() => active ? watchClassroomViewport() : undefined, [active]);
}
