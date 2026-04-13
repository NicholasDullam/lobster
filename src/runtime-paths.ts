/**
 * Resolves a public asset URL against Vite's deployed base path.
 *
 * This keeps static `public/` assets working when the app is hosted under a
 * GitHub Pages project path such as `/repo-name/`.
 *
 * @param relativePath - Asset path relative to the `public/` directory
 * @returns Base-aware URL that can be used at runtime
 */
export function publicAssetUrl(relativePath: string): string {
  const normalizedRelativePath = relativePath.replace(/^\/+/, "");
  return `${import.meta.env.BASE_URL}${normalizedRelativePath}`;
}

/**
 * Returns the current pathname with the deployed base path removed.
 *
 * This lets route-like checks continue to work locally at `/...` and on
 * GitHub Pages at `/repo-name/...` without hard-coding the repository name.
 *
 * @param pathname - Current browser pathname to normalize
 * @returns Pathname relative to the deployed app root
 */
export function baseRelativePathname(
  pathname: string = window.location.pathname,
): string {
  const normalizedPathname = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const basePathname = new URL(import.meta.env.BASE_URL, window.location.origin)
    .pathname
    .replace(/\/$/, "");

  if (!basePathname) {
    return normalizedPathname;
  }

  return normalizedPathname.startsWith(basePathname)
    ? normalizedPathname.slice(basePathname.length) || "/"
    : normalizedPathname;
}
