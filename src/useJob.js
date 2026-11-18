import { useEffect, useState } from 'react';
import { eventsUrl } from './api.js';

const IDLE = { id: null, data: null, gone: false, clockOffset: 0 };
const finished = (data) => data.status === 'done' || data.status === 'failed';

/**
 * Follows a job over server-sent events: a full snapshot first, then
 * `update` patches and `log` lines until the job is done or has failed.
 */
export function useJob(jobId) {
  const [state, setState] = useState(IDLE);

  useEffect(() => {
    if (!jobId) {
      setState(IDLE);
      return undefined;
    }
    setState({ ...IDLE, id: jobId });
    const source = new EventSource(eventsUrl(jobId));
    const patch = (fn) => setState((s) => (s.id === jobId && s.data ? { ...s, data: fn(s.data) } : s));

    source.addEventListener('snapshot', (e) => {
      const data = JSON.parse(e.data);
      setState({ id: jobId, data, gone: false, clockOffset: Date.now() - data.serverTime });
      if (finished(data)) source.close();
    });
    source.addEventListener('update', (e) => {
      const changes = JSON.parse(e.data);
      patch((data) => ({ ...data, ...changes }));
    });
    source.addEventListener('log', (e) => {
      const entry = JSON.parse(e.data);
      patch((data) => ({ ...data, logs: [...data.logs, entry] }));
    });
    source.addEventListener('gone', () => {
      source.close();
      setState({ ...IDLE, id: jobId, gone: true });
    });
    return () => source.close();
  }, [jobId]);

  return state;
}
