// API utility functions
const getBasePath = () => {
  const pathname = window.location.pathname;
  if (pathname.includes('/ringba-sync-dashboard')) {
    return '/ringba-sync-dashboard';
  }
  return '';
};

export const BASE_PATH = getBasePath();
export const API_BASE_URL = window.location.origin + BASE_PATH;

console.log('[Dashboard] Base path:', BASE_PATH);
console.log('[Dashboard] API base URL:', API_BASE_URL);

// Fetch wrapper with error handling
const fetchAPI = async (endpoint, options = {}) => {
  const url = `${API_BASE_URL}${endpoint}`;
  console.log('[Dashboard] Fetching:', url);
  
  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('[Dashboard] API Error:', error);
    throw error;
  }
};

// API endpoints
export const api = {
  health: () => fetchAPI('/api/health'),
  stats: () => fetchAPI('/api/stats'),
  history: (service = null, limit = 50) => {
    const params = new URLSearchParams();
    if (service) params.append('service', service);
    params.append('limit', limit.toString());
    return fetchAPI(`/api/history?${params.toString()}`);
  },
  activity: (limit = 20) => fetchAPI(`/api/activity?limit=${limit}`),
  ringbaLogs: (status = null, limit = 50) => {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    params.append('limit', limit.toString());
    return fetchAPI(`/api/ringba-logs?${params.toString()}`);
  },
  chargeback: (limit = null) => {
    // If limit is null/undefined, fetch all data; otherwise use the limit
    if (limit === null || limit === undefined) {
      return fetchAPI('/api/chargeback');
    }
    return fetchAPI(`/api/chargeback?limit=${limit}`);
  }
};

