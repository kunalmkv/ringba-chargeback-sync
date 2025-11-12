import { useState, useEffect, useCallback } from 'react';
import { api } from '../utils/api';

export const useDashboardData = () => {
  const [health, setHealth] = useState(null);
  const [stats, setStats] = useState(null);
  const [history, setHistory] = useState(null);
  const [activity, setActivity] = useState({ calls: [], adjustments: [], sessions: [] });
  const [topCallers, setTopCallers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadHealth = useCallback(async () => {
    try {
      const data = await api.health();
      setHealth(data);
      return data;
    } catch (err) {
      console.error('Error loading health:', err);
      throw err;
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const data = await api.stats();
      setStats(data);
      setTopCallers(data.topCallers || []);
      return data;
    } catch (err) {
      console.error('Error loading stats:', err);
      throw err;
    }
  }, []);

  const loadHistory = useCallback(async (service = null, limit = 20) => {
    try {
      const data = await api.history(service, limit);
      setHistory(data.sessions || []);
      return data;
    } catch (err) {
      console.error('Error loading history:', err);
      throw err;
    }
  }, []);

  const loadActivity = useCallback(async () => {
    try {
      const data = await api.activity(20);
      setActivity({
        calls: data.calls || [],
        adjustments: data.adjustments || [],
        sessions: data.sessions || []
      });
      return data;
    } catch (err) {
      console.error('Error loading activity:', err);
      throw err;
    }
  }, []);

  const loadAllData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([
        loadHealth(),
        loadStats(),
        loadHistory(),
        loadActivity()
      ]);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [loadHealth, loadStats, loadHistory, loadActivity]);

  useEffect(() => {
    loadAllData();
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(() => {
      loadAllData();
    }, 30000);

    return () => clearInterval(interval);
  }, [loadAllData]);

  return {
    health,
    stats,
    history,
    activity,
    topCallers,
    loading,
    error,
    lastUpdated,
    loadAllData,
    loadHistory,
    loadActivity
  };
};

