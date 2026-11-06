// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { watchClassroomViewport } from "@/lib/useClassroomViewport";

let stop: (() => void) | undefined;
afterEach(() => { stop?.(); stop = undefined; vi.unstubAllGlobals(); vi.restoreAllMocks(); document.documentElement.removeAttribute("style"); delete document.documentElement.dataset.classroomTouch; });
function viewport() {
  const visible = Object.assign(new EventTarget(), { height: 1024, offsetTop: 0, scale: 1 });
  vi.stubGlobal("visualViewport", visible);
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
  vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", maxTouchPoints: 5 });
  return visible;
}
const style = (name: string) => document.documentElement.style.getPropertyValue(name);
describe("the classroom viewport on iPad Safari", () => {
  it("recognizes an iPad with a trackpad even when media queries report a fine pointer", () => {
    viewport(); stop = watchClassroomViewport();
    expect(document.documentElement.dataset.classroomTouch).toBe("true");
  });
  it("follows the keyboard without relying on a layout-viewport resize", () => {
    const visible = viewport(); const layoutHeight = window.innerHeight; stop = watchClassroomViewport();
    expect(style("--classroom-visual-height")).toBe("1024px");
    visible.height = 420; visible.offsetTop = 70; visible.dispatchEvent(new Event("resize"));
    expect(window.innerHeight).toBe(layoutHeight);
    expect(style("--classroom-visual-height")).toBe("420px");
    expect(style("--classroom-visual-top")).toBe("70px");
    visible.height = 1024; visible.offsetTop = 0; visible.dispatchEvent(new Event("scroll"));
    expect(style("--classroom-visual-height")).toBe("1024px");
    expect(style("--classroom-visual-top")).toBe("0px");
  });
  it("does not squeeze the layout when someone uses browser pinch zoom", () => {
    const visible = viewport(); stop = watchClassroomViewport();
    visible.scale = 2; visible.height = 512; visible.dispatchEvent(new Event("resize"));
    expect(style("--classroom-visual-height")).toBe("1024px");
    visible.scale = 1; visible.height = 768; visible.dispatchEvent(new Event("resize"));
    expect(style("--classroom-visual-height")).toBe("768px");
  });
  it("restores existing styles and detaches viewport listeners on leaving classroom mode", () => {
    const visible = viewport(); document.documentElement.style.setProperty("--classroom-visual-height", "777px");
    document.documentElement.dataset.classroomTouch = "false";
    const cleanup = watchClassroomViewport(); cleanup();
    visible.height = 400; visible.dispatchEvent(new Event("resize"));
    expect(style("--classroom-visual-height")).toBe("777px");
    expect(style("--classroom-visual-top")).toBe("");
    expect(document.documentElement.dataset.classroomTouch).toBe("false");
  });
  it("works when visualViewport is unavailable, without enabling touch layout on a desktop", () => {
    viewport(); vi.stubGlobal("visualViewport", undefined);
    vi.stubGlobal("navigator", { userAgent: navigator.userAgent, maxTouchPoints: 0 });
    stop = watchClassroomViewport();
    expect(style("--classroom-visual-height")).toBe(`${window.innerHeight}px`);
    expect(document.documentElement.dataset.classroomTouch).toBe("false");
  });
});
