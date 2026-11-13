const LOST_CONNECTION = /closed|disconnected|crashed/i;
const CAPTURE_TIMEOUT = /capture timed out/i;

export const lostConnection = (error) => LOST_CONNECTION.test(error?.message ?? "");

export const captureTimeout = (error) => CAPTURE_TIMEOUT.test(error?.message ?? "");

export const worthRetrying = (error, attempt) => attempt === 0 && (lostConnection(error) || captureTimeout(error));
