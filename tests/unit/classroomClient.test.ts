// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { setClassroomWorkspace, editorStorage, scopedDatabase, scopedKey, workspaceUrl, workspacePageUrl, classroomFetch, registerClassroomSaveGuard, flushClassroomBeforeLogout } from "@/lib/classroom/client";
afterEach(() => { setClassroomWorkspace(null); localStorage.clear(); vi.unstubAllGlobals(); });
describe("per-student browser state", () => {
  it("separates projects, clipboard and recovery databases on a shared device", () => {
    localStorage.setItem("layerling.projects", "old browser projects");
    setClassroomWorkspace("ben"); editorStorage().setItem("layerling.projects", "Ben's projects"); editorStorage().setItem("layerling.clipboard", "Ben's object");
    expect(scopedDatabase("shapes")).toBe("classroom.ben.shapes");
    setClassroomWorkspace("tim"); expect(editorStorage().getItem("layerling.projects")).toBeNull(); expect(editorStorage().getItem("layerling.clipboard")).toBeNull();
    editorStorage().setItem("layerling.projects", "Tim's projects");
    setClassroomWorkspace("ben"); expect(editorStorage().getItem("layerling.projects")).toBe("Ben's projects");
    expect(editorStorage().length).toBe(2); editorStorage().clear(); expect(localStorage.getItem("layerling.projects")).toBe("old browser projects");
    setClassroomWorkspace("tim"); expect(editorStorage().getItem("layerling.projects")).toBe("Tim's projects");
  });
  it("adds selectors for API image URLs and requests, preserving revision headers", async () => {
    setClassroomWorkspace("ben"); const fetch = vi.fn().mockResolvedValue(new Response()); vi.stubGlobal("fetch", fetch);
    await classroomFetch("/api/shared-projects", { headers: { "if-match": "rev" } });
    const headers = fetch.mock.calls[0][1].headers as Headers; expect(headers.get("x-layerling-student")).toBe("ben"); expect(headers.get("if-match")).toBe("rev");
    expect(workspacePageUrl("/?editor=1&project=a")).toBe("/?editor=1&project=a&student=ben");
    expect(workspaceUrl("/api/project-thumbnail?projectId=a")).toBe("/api/project-thumbnail?projectId=a&student=ben");
    await classroomFetch("https://example.com/update"); expect(fetch.mock.calls[1]).toEqual(["https://example.com/update", undefined]);
  });
  it("waits for the editor save guard and preserves save failures for logout", async () => {
    const save = vi.fn().mockResolvedValue(undefined); const unregister = registerClassroomSaveGuard(save);
    await flushClassroomBeforeLogout(); expect(save).toHaveBeenCalledOnce(); unregister();
    await flushClassroomBeforeLogout(); expect(save).toHaveBeenCalledOnce();
    const remove = registerClassroomSaveGuard(async () => { throw new Error("not saved"); });
    await expect(flushClassroomBeforeLogout()).rejects.toThrow("not saved"); remove();
  });
  it("leaves the original non-classroom workflow unchanged", () => {
    expect(editorStorage()).toBe(localStorage); expect(scopedKey("layerling.projects")).toBe("layerling.projects"); expect(scopedDatabase("shapes")).toBe("shapes");
  });
});
