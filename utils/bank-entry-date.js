function bankEntryDate(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  const date = new Date(`${text}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    const error = new Error('Select a valid transaction date (YYYY-MM-DD)');
    error.statusCode = 400;
    throw error;
  }
  return text;
}
module.exports = { bankEntryDate };
