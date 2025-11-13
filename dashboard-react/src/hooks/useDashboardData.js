import { useState, useEffect, useCallback } from 'react';
import { api } from '../utils/api';

// Get initial data from embedded script tag (if available)
const getInitialData = () => {
  try {
    const scriptTag = document.getElementById('dashboard-initial-data');
    if (scriptTag && scriptTag.textContent) {
      const data = JSON.parse(scriptTag.textContent);
      console.log('[Dashboard] Loaded initial data from embedded script');
      return data;
    }
  } catch (error) {
    console.warn('[Dashboard] Could not parse initial data:', error);
  }
  return null;
};

export const useDashboardData = () => {
  // Initialize with embedded data if available
  const initialData = getInitialData();
  
  const [health, setHealth] = useState(initialData?.health || null);
  const [stats, setStats] = useState(initialData?.stats || null);
  const [history, setHistory] = useState(initialData?.history?.sessions || null);
  const [activity, setActivity] = useState(initialData?.activity || { calls: [], adjustments: [], sessions: [] });
  const [chargeback, setChargeback] = useState(initialData?.chargeback || null);
  const [loading, setLoading] = useState(!initialData); // Only loading if no initial data
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(initialData?.timestamp ? new Date(initialData.timestamp) : null);

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

  const loadChargeback = useCallback(async (limit = null) => {
    try {
      // If limit is null/undefined, fetch all data; otherwise use the limit
      const data = await api.chargeback(limit);
      setChargeback(data);
      return data;
    } catch (err) {
      console.error('Error loading chargeback data:', err);
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
        loadActivity(),
        loadChargeback()
      ]);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [loadHealth, loadStats, loadHistory, loadActivity, loadChargeback]);

  useEffect(() => {
    // Get initial data on mount (in case it wasn't available during hook initialization)
    const data = getInitialData();
    
    // If we have initial data, skip initial load
    if (!data) {
      loadAllData();
    } else {
      setLoading(false);
      setLastUpdated(new Date(data.timestamp));
    }
    
    // Auto-refresh disabled - data is fresh on each page load
    // If refresh is needed, user can reload the page
  }, [loadAllData]);

  return {
    health,
    stats,
    history,
    activity,
    chargeback,
    loading,
    error,
    lastUpdated,
    loadAllData,
    loadHistory,
    loadActivity,
    loadChargeback
  };
};

