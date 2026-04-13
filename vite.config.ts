import { defineConfig } from "vite";

/**
 * Repository name used for GitHub Pages project-site builds.
 *
 * The workflow sets `GITHUB_PAGES_REPOSITORY_NAME` automatically, while local
 * Pages smoke tests fall back to the current repository name.
 */
const GITHUB_PAGES_REPOSITORY_NAME =
  process.env.GITHUB_PAGES_REPOSITORY_NAME ??
  process.env.GITHUB_REPOSITORY?.split("/")[1] ??
  "obs-face-filter";

export default defineConfig(({ mode }) => ({
  base: mode === "github-pages" ? `/${GITHUB_PAGES_REPOSITORY_NAME}/` : "/",
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        spin: "spin.html",
      },
    },
  },
}));
