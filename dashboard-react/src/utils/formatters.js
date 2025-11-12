// Formatting utility functions
export const formatNumber = (num) => {
  return new Intl.NumberFormat('en-US').format(num || 0);
};

export const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(amount || 0);
};

export const formatDate = (dateString) => {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
};

export const formatDateTime = (dateString) => {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

export const formatRelativeTime = (date) => {
  if (!date) return '-';
  const now = new Date();
  const diff = now - date;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days} day${days > 1 ? 's' : ''} ago`;
  } else if (hours > 0) {
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  } else if (minutes > 0) {
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  } else {
    return 'Just now';
  }
};

export const truncate = (str, maxLength) => {
  if (!str) return '-';
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
};

export const getServiceName = (sessionId) => {
  if (!sessionId) return 'Unknown';
  if (sessionId.startsWith('historical_')) return 'Historical';
  if (sessionId.startsWith('current_')) return 'Current Day';
  if (sessionId.includes('historical')) return 'Historical';
  if (sessionId.includes('current')) return 'Current Day';
  return 'Unknown';
};

export const getStatusClass = (status) => {
  if (status === 'completed' || status === 'success') {
    return 'success';
  } else if (status === 'failed' || status === 'error') {
    return 'error';
  } else if (status === 'running' || status === 'pending') {
    return 'warning';
  }
  return '';
};

