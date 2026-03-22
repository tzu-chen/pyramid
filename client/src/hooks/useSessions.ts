import { useState, useEffect, useCallback } from 'react';
import { Session } from '../types';
import { sessionService } from '../services/sessionService';

interface UseSessionsParams {
  session_type?: string;
  status?: string;
  language?: string;
  tag?: string;
  search?: string;
}

export function useSessions(params: UseSessionsParams = {}) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await sessionService.list(params);
      setSessions(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [params.session_type, params.status, params.language, params.tag, params.search]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { sessions, loading, error, refresh: fetch };
}
