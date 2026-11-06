import { NextResponse } from "next/server";
import { ClassroomError, enabled, workspaceStudent } from "./store";
export function classroomFailure(error: unknown) {
  if (!(error instanceof ClassroomError)) console.error("Classroom operation failed", error instanceof Error ? error.message : "unknown error");
  return NextResponse.json({ error: error instanceof ClassroomError ? error.message : "Serverfehler. Bitte Serverprotokoll prüfen." }, { status: error instanceof ClassroomError ? error.status : 500, headers: { "Cache-Control": "no-store" } });
}
export function guardWorkspace(handler: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    try {
      if (enabled()) await workspaceStudent(request);
      const response = await handler(request);
      if (enabled()) { response.headers.set("Cache-Control", "private, no-store"); response.headers.set("Vary", "Cookie, x-layerling-student"); }
      return response;
    } catch (error) { return classroomFailure(error); }
  };
}
