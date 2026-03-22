import { useState, useEffect, useCallback } from 'react';
import { SessionDetail } from '../types';
import { sessionService } from '../services/sessionService';

export function useSession(id: string | undefined) {
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await sessionService.get(id);
      setSession(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { session, setSession, loading, error, refresh: fetch };
}
