// Date utility functions for eLocal scraper services
import * as R from 'ramda';

// Format date for eLocal website (MM/DD/YYYY)
export const formatDateForElocal = (date) => {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
};

// Format date for URL parameters (YYYY-MM-DD)
export const formatDateForURL = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Get date range for past N days (excluding today)
export const getPastDaysRange = (days, excludeToday = true) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const endDate = excludeToday 
    ? new Date(today.getTime() - 24 * 60 * 60 * 1000) // Yesterday
    : today;
  
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - (days - 1)); // Go back N days
  
  return {
    startDate,
    endDate,
    startDateFormatted: formatDateForElocal(startDate),
    endDateFormatted: formatDateForElocal(endDate),
    startDateURL: formatDateForURL(startDate),
    endDateURL: formatDateForURL(endDate),
    days: Math.ceil((endDate - startDate) / (24 * 60 * 60 * 1000)) + 1
  };
};

// Get current day date range
export const getCurrentDayRange = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const endDate = new Date(today);
  endDate.setHours(23, 59, 59, 999); // End of today
  
  return {
    startDate: today,
    endDate: endDate,
    startDateFormatted: formatDateForElocal(today),
    endDateFormatted: formatDateForElocal(today), // Same date for single day
    startDateURL: formatDateForURL(today),
    endDateURL: formatDateForURL(today),
    days: 1
  };
};

// Get past 10 days (excluding today)
export const getPast10DaysRange = () => getPastDaysRange(10, true);

// Check if date is within range
export const isDateInRange = (date, startDate, endDate) => {
  const checkDate = new Date(date);
  checkDate.setHours(0, 0, 0, 0);
  
  return checkDate >= startDate && checkDate <= endDate;
};

// Generate date range description
export const getDateRangeDescription = (dateRange) => {
  return `${dateRange.startDateFormatted} to ${dateRange.endDateFormatted} (${dateRange.days} days)`;
};

// Create date range for service
export const createServiceDateRange = (serviceType) => {
  switch (serviceType) {
    case 'historical':
      return getPast10DaysRange();
    case 'current':
      return getCurrentDayRange();
    default:
      throw new Error(`Unknown service type: ${serviceType}`);
  }
};

// Validate date range
export const validateDateRange = (dateRange) => {
  if (!dateRange.startDate || !dateRange.endDate) {
    return { valid: false, error: 'Missing start or end date' };
  }
  
  if (dateRange.startDate > dateRange.endDate) {
    return { valid: false, error: 'Start date is after end date' };
  }
  
  const daysDiff = Math.ceil((dateRange.endDate - dateRange.startDate) / (24 * 60 * 60 * 1000)) + 1;
  if (daysDiff > 30) {
    return { valid: false, error: 'Date range exceeds 30 days' };
  }
  
  return { valid: true };
};

// Format date for database (ISO string)
export const formatDateForDatabase = (date) => {
  return new Date(date).toISOString();
};

// Parse date from various formats
export const parseDate = (dateStr) => {
  if (!dateStr) return null;
  
  // Try parsing as ISO string
  let date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    return date;
  }
  
  // Try parsing as MM/DD/YYYY
  const mmddyyyy = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (mmddyyyy) {
    date = new Date(
      parseInt(mmddyyyy[3]), // year
      parseInt(mmddyyyy[1]) - 1, // month (0-indexed)
      parseInt(mmddyyyy[2]) // day
    );
    if (!isNaN(date.getTime())) {
      return date;
    }
  }
  
  return null;
};

// Get service schedule info
export const getServiceScheduleInfo = (serviceType) => {
  switch (serviceType) {
    case 'historical':
      return {
        name: 'Historical Data Service',
        description: 'Fetches data for past 10 days (excluding today)',
        cronExpression: '0 2 * * *', // Every day at 2 AM
        interval: '24 hours',
        dateRange: getPast10DaysRange()
      };
    case 'current':
      return {
        name: 'Current Day Service',
        description: 'Fetches data for current day only',
        cronExpression: '0 */3 * * *', // Every 3 hours
        interval: '3 hours',
        dateRange: getCurrentDayRange()
      };
    default:
      throw new Error(`Unknown service type: ${serviceType}`);
  }
};

// Export utilities
export const dateUtils = {
  formatDateForElocal,
  getPastDaysRange,
  getCurrentDayRange,
  getPast10DaysRange,
  isDateInRange,
  getDateRangeDescription,
  createServiceDateRange,
  validateDateRange,
  formatDateForDatabase,
  parseDate,
  getServiceScheduleInfo
};
