const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const apiUrl = (path) => `${API_BASE_URL}${path}`;

async function request(path, options) {
  let res;
  try {
    res = await fetch(apiUrl(path), options);
  } catch {
    throw new Error("Couldn't reach the server. Check that it's running, then try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `The server answered with status ${res.status}.`);
    err.field = data.field;
    throw err;
  }
  return data;
}

export const getConfig = () => request('/api/config');

export const createJob = (body) =>
  request('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const encodePath = (rel) => rel.split('/').map(encodeURIComponent).join('/');

export const fileUrl = (id, rel) => apiUrl(`/api/jobs/${id}/files/${encodePath(rel)}`);
export const thumbUrl = (id, rel) => apiUrl(`/api/jobs/${id}/thumbs/${encodePath(rel)}`);
export const zipUrl = (id) => apiUrl(`/api/jobs/${id}/download`);
export const eventsUrl = (id) => apiUrl(`/api/jobs/${encodeURIComponent(id)}/events`);
