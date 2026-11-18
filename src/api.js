async function request(path, options) {
  let res;
  try {
    res = await fetch(path, options);
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

export const fileUrl = (id, rel) => `/api/jobs/${id}/files/${encodePath(rel)}`;
export const thumbUrl = (id, rel) => `/api/jobs/${id}/thumbs/${encodePath(rel)}`;
export const zipUrl = (id) => `/api/jobs/${id}/download`;
export const eventsUrl = (id) => `/api/jobs/${encodeURIComponent(id)}/events`;
