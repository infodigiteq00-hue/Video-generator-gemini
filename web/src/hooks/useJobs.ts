import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { isActiveStatus, type Job } from '../types';

const POLL_MS = 3000;

export function useJobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const list = await api.listJobs();
      if (!mounted.current) return;
      setJobs(list);
      setError(null);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : 'Failed to load history');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upsert = useCallback((job: Job) => {
    setJobs((prev) => {
      const i = prev.findIndex((j) => j.id === job.id);
      if (i === -1) return [job, ...prev];
      const next = prev.slice();
      next[i] = job;
      return next;
    });
  }, []);

  const removeLocal = useCallback((id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  const remove = useCallback(
    async (id: string) => {
      await api.deleteJob(id);
      removeLocal(id);
    },
    [removeLocal],
  );

  // Poll every running/queued job every 3s. Keyed on the set of active ids so the
  // loop restarts only when that set changes.
  const activeKey = jobs
    .filter((j) => isActiveStatus(j.status))
    .map((j) => j.id)
    .join(',');

  // While anything is rendering, refresh the whole list: the server can add jobs on its own
  // (a brand post starts its video once the image is ready).
  useEffect(() => {
    if (!activeKey) return;
    const timer = setTimeout(() => void refresh(), POLL_MS);
    return () => clearTimeout(timer);
  }, [activeKey, jobs, refresh]);

  return { jobs, loading, error, refresh, upsert, remove };
}
