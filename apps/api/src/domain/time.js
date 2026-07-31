export function parseDateInput(value, fallback = new Date().toISOString()) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return value.slice(0, 10);
  return fallback.slice(0, 10);
}

export function parseTime(value) {
  if (typeof value !== 'string') return '00:00';
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '00:00';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return '00:00';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function addDays(dateInput, days) {
  const date = new Date(`${parseDateInput(dateInput)}T00:00:00`);
  date.setDate(date.getDate() + days);
  return formatDate(date);
}

export function addMinutes(dateInput, minutes) {
  if (typeof dateInput === 'string' && /^\d{2}:\d{2}$/.test(dateInput)) {
    const [hour, minute] = dateInput.split(':').map(Number);
    const total = hour * 60 + minute + minutes;
    const next = total < 0 ? 0 : total;
    return `${String(Math.floor(next / 60) % 24).padStart(2, '0')}:${String(next % 60).padStart(2, '0')}`;
  }
  const date = new Date(`${parseDateInput(dateInput)}T00:00:00`);
  date.setMinutes(date.getMinutes() + minutes);
  return `${formatDate(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:00`;
}

export function getWeekday(dateInput) {
  const date = new Date(`${parseDateInput(dateInput)}T00:00:00`);
  return date.getDay();
}

export function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function nowIso() {
  return new Date().toISOString();
}
