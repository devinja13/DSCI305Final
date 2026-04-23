import { useEffect, useRef } from 'react';
import { useOptimizeStore } from '../store/useOptimizeStore';

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';
const POLL_INTERVAL_MS = 3000;

export function useJobPoller() {
  const { jobId, jobStatus, setJobStatus, setProgress, setResult, setError } =
    useOptimizeStore();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const failCountRef = useRef(0);

  useEffect(() => {
    if (!jobId || jobStatus === 'complete' || jobStatus === 'failed') return;

    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/job/${jobId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        failCountRef.current = 0;

        setProgress(data.progress ?? 0);

        if (data.status === 'complete') {
          setResult(data.result);
          clearInterval(intervalRef.current!);
        } else if (data.status === 'cancelled') {
          setJobStatus('cancelled');
          clearInterval(intervalRef.current!);
        } else if (data.status === 'failed') {
          setError(data.error ?? 'Optimization failed');
          clearInterval(intervalRef.current!);
        } else {
          setJobStatus(data.status);
        }
      } catch {
        failCountRef.current++;
        if (failCountRef.current >= 5) {
          setError('Lost connection to server');
          clearInterval(intervalRef.current!);
        }
      }
    };

    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps
}
