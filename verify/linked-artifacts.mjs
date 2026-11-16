const BLOCKED_FILE_SCRIPT = /^Access to script at 'file:\/\/\/[^']*' from origin 'null' has been blocked by CORS policy/;
const FAILED_RESOURCE = /^Failed to load resource: net::ERR_FAILED$/;
const MISSING_FILE = /^Failed to load resource: net::ERR_FILE_NOT_FOUND$/;

export const isLinkedFileLoadFailure = (text, location = {}) =>
  BLOCKED_FILE_SCRIPT.test(text) || (FAILED_RESOURCE.test(text) && String(location.url ?? "").startsWith("file:"));

export const isMissingFile = (text, location = {}) =>
  MISSING_FILE.test(text) && (!location.url || String(location.url).startsWith("file:"));
