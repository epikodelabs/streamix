export type RouterUrlMode = 'navigate' | 'href';

export function normalizePath(path: string): string {
  const normalized = `/${path}`.replace(/\/+/g, '/');
  return normalized.length > 1 && normalized.endsWith('/')
    ? normalized.slice(0, -1)
    : normalized;
}

export function normalizeBaseHref(value: string): string {
  return normalizePath(value.trim() || '/');
}

export function isPathInsideBase(pathname: string, baseHref: string): boolean {
  const base = normalizeBaseHref(baseHref);
  const path = normalizePath(pathname);
  return base === '/' || path === base || path.startsWith(`${base}/`);
}

export function stripBaseHref(pathname: string, baseHref: string): string {
  const base = normalizeBaseHref(baseHref);
  const path = normalizePath(pathname);
  if (base === '/' || !isPathInsideBase(path, base)) return path;
  return normalizePath(path.slice(base.length));
}

export function applyBaseHref(pathname: string, baseHref: string): string {
  const base = normalizeBaseHref(baseHref);
  const path = normalizePath(pathname);
  if (base === '/' || isPathInsideBase(path, base)) return path;
  return path === '/' ? base : normalizePath(`${base}/${path.slice(1)}`);
}

export function resolveRouterUrl(
  target: string | URL,
  baseHref: string,
  location: Pick<Location, 'origin' | 'pathname' | 'href'>,
  mode: RouterUrlMode,
): URL {
  if (target instanceof URL) return target;

  const value = String(target);
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return new URL(value);
  if (value.startsWith('?') || value.startsWith('#')) {
    return new URL(value, location.href);
  }

  const base = normalizeBaseHref(baseHref);
  if (value.startsWith('/')) {
    const url = new URL(value, location.origin);
    if (mode === 'href') url.pathname = applyBaseHref(url.pathname, base);
    return url;
  }

  const relativeBase = isPathInsideBase(location.pathname, base)
    ? location.href
    : `${location.origin}${base}/`;
  return new URL(value, relativeBase);
}

export function routerHref(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
}
