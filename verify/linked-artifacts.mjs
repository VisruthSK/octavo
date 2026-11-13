const BLOCKED_FILE_SCRIPT = /^Access to script at 'file:\/\/\/[^']*' from origin 'null' has been blocked by CORS policy/;
const FAILED_RESOURCE = /^Failed to load resource: net::ERR_(FAILED|FILE_NOT_FOUND)$/;

export const isLinkedFileLoadFailure = (text, location = {}) =>
  BLOCKED_FILE_SCRIPT.test(text) || (FAILED_RESOURCE.test(text) && String(location.url ?? "").startsWith("file:"));
