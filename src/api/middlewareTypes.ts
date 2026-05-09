import type { createAuthMiddleware } from "../auth/middleware.js";

export type AuthMiddleware = ReturnType<typeof createAuthMiddleware>;
