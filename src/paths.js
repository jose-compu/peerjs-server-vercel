const MOUNT_PREFIX = '/api/server';

export function normalizeBase(path) {
  if (!path || path === '/') {
    return '/';
  }

  let value = path.startsWith('/') ? path : `/${path}`;
  if (value.length > 1 && value.endsWith('/')) {
    value = value.slice(0, -1);
  }

  return value || '/';
}

export function joinBase(base, ...parts) {
  const normalized = normalizeBase(base);
  const suffix = parts
    .flat()
    .filter((part) => part !== undefined && part !== null && String(part) !== '')
    .map((part) => String(part).replace(/^\/+|\/+$/g, ''))
    .join('/');

  if (!suffix) {
    return normalized;
  }

  if (normalized === '/') {
    return `/${suffix}`;
  }

  return `${normalized}/${suffix}`;
}

export function logicalPath(pathname) {
  let path = pathname || '/';

  while (path === MOUNT_PREFIX || path.startsWith(`${MOUNT_PREFIX}/`)) {
    path = path === MOUNT_PREFIX ? '/' : path.slice(MOUNT_PREFIX.length) || '/';
  }

  if (!path.startsWith('/')) {
    path = `/${path}`;
  }

  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }

  return path || '/';
}

export function socketPath(basePath) {
  return joinBase(basePath, 'peerjs');
}

export function idPath(basePath, key) {
  return joinBase(basePath, key, 'id');
}

export function peersPath(basePath, key) {
  return joinBase(basePath, key, 'peers');
}
