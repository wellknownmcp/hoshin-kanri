// Tool arguments (matrix_id, share_id, element_id…) are interpolated into API
// paths. fetch resolves '..' segments and drops '#…', so an unchecked id could
// turn "revoke a share" into DELETE /api/matrices/<other> or GET /api/users with
// the user's Bearer. Every path segment must be a plain identifier.
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9_-]+$/;

// The query string is built by the tools from fixed keys and URLSearchParams,
// so it never holds '/', '?' or '#': one that does means an id carried a '?'
// and cut the path short (`<id>?/shares/x` would DELETE the matrix itself).
const SAFE_QUERY = /^[A-Za-z0-9_=&,.%+*-]*$/; // URLSearchParams leaves *-._ unencoded

export function assertSafeEndpoint(endpoint) {
  const q = endpoint.indexOf('?');
  const path = q < 0 ? endpoint : endpoint.slice(0, q);
  const query = q < 0 ? '' : endpoint.slice(q + 1);
  const segments = path.split('/').slice(1);
  if (
    !SAFE_QUERY.test(query) ||
    segments[0] !== 'api' ||
    !segments.every((s) => SAFE_PATH_SEGMENT.test(s))
  ) {
    throw new Error('Invalid identifier: ids must be the plain ids returned by the tools.');
  }
}
