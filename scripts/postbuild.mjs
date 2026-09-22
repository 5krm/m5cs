/**
 * Post-build step for self-hosted / standalone deployments.
 *
 * `next build` (with `output: "standalone"`) emits a self-contained server bundle in
 * `.next/standalone/`, but it does NOT copy the browser build assets or the `public/`
 * folder into it — Docker images and `npm start` need those in place.
 *
 * On Vercel this does nothing: `output` is not "standalone" there (see next.config.ts)
 * and Vercel's own build pipeline serves `.next/static` and `public/` itself.
 *
 * Usage: `node scripts/postbuild.mjs`  (wired into `npm run build`)
 */
import { cp, access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");

const exists = async (p) => {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

if (process.env.VERCEL) {
  console.log("[postbuild] Vercel build detected — skipping standalone asset copy.");
} else if (!(await exists(standalone))) {
  console.log("[postbuild] No .next/standalone directory — nothing to copy.");
} else {
  await cp(
    path.join(root, ".next", "static"),
    path.join(standalone, ".next", "static"),
    { recursive: true },
  );
  await cp(path.join(root, "public"), path.join(standalone, "public"), {
    recursive: true,
  });
  console.log("[postbuild] Copied .next/static and public/ into .next/standalone.");
}
