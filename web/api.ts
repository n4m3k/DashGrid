export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  revision?: number,
): Promise<T> {
  const token = sessionStorage.getItem('dashgrid-key');
  const response = await fetch(`/api/v1${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(revision !== undefined ? { 'If-Match': `"${revision}"` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: `Erreur HTTP ${response.status}` }));
    throw new Error(error.error || `Erreur HTTP ${response.status}`);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
