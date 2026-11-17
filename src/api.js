export async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
  });
  let data;
  try { data = await response.json(); }
  catch { throw new Error(`Server returned non-JSON response (${response.status}). Check that the API service is running.`); }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
export const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
export const patch = (path, body) => api(path, { method: 'PATCH', body: JSON.stringify(body) });
export const del = path => api(path, { method: 'DELETE' });
