import "dotenv/config";
import { clearGoogleOAuthSession } from "../src/auth/googleOAuthSession.js";

clearGoogleOAuthSession();
process.stdout.write("Cleared local Google OAuth session.\n");
process.stdout.write("Run npm run auth:google to sign in again.\n");
