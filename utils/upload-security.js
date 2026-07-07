const path = require('path');

const ALLOWED = {
  image: {
    mimes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'],
    exts: ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif'],
  },
  audio: {
    mimes: [
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/x-wav',
      'audio/mp4',
      'audio/x-m4a',
      'audio/aac',
      'audio/ogg',
      'audio/webm',
      'video/webm',
    ],
    exts: ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.oga', '.webm'],
  },
  pdf: {
    mimes: ['application/pdf'],
    exts: ['.pdf'],
  },
  spreadsheet: {
    mimes: [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'application/csv',
      'application/vnd.ms-office',
      'application/octet-stream',
    ],
    exts: ['.xls', '.xlsx', '.csv'],
  },
  tenantDoc: {
    mimes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
    exts: ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'],
  },
  societyAttachment: {
    mimes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'],
    exts: ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif'],
  },
};

function extOf(file) {
  return String(path.extname(file?.originalname || '') || '').trim().toLowerCase();
}

function mimeOf(file) {
  return String(file?.mimetype || '').trim().toLowerCase();
}

function validateUploadedFile(file, kind = 'image') {
  const policy = ALLOWED[kind];
  if (!policy) throw new Error(`Unknown upload validation kind: ${kind}`);
  if (!file) throw new Error('No file uploaded');
  const mime = mimeOf(file);
  const ext = extOf(file);
  const okMime = policy.mimes.includes(mime);
  const okExt = policy.exts.includes(ext);
  if (!okMime && !okExt) {
    throw new Error(`Unsupported file type for ${kind} upload.`);
  }
  return true;
}

function multerFileFilterFor(kind = 'image') {
  return (_req, file, cb) => {
    try {
      validateUploadedFile(file, kind);
      cb(null, true);
    } catch (err) {
      cb(err);
    }
  };
}

function inferUploadKindFromRequest(req) {
  const rawPath = String(req.originalUrl || req.path || '').toLowerCase();
  if (rawPath.includes('/voice-prefill') || rawPath.includes('/ai/lookup/voice')) return 'audio';
  if (rawPath.includes('/poster-upload') || rawPath.includes('/profile-photo') || rawPath.includes('/scan-image')) return 'image';
  if (rawPath.includes('/upload') && rawPath.includes('/tenants')) return 'tenantDoc';
  if (rawPath.includes('/societies') && rawPath.includes('/expenses')) return 'societyAttachment';
  if (rawPath.includes('/bill-match')) return 'pdf';
  if (rawPath.includes('/import') || rawPath.includes('/excel') || rawPath.includes('/sheets') || rawPath.includes('/preview')) return 'spreadsheet';
  return 'image';
}

module.exports = {
  inferUploadKindFromRequest,
  multerFileFilterFor,
  validateUploadedFile,
};
