'use strict';

class PackagerError extends Error {
  constructor(message, { cause, code } = {}) {
    super(message);
    this.name = 'PackagerError';
    this.code = code || 'E_PACKAGER';
    if (cause) this.cause = cause;
  }
}

function firstLine(err) {
  const msg = err && err.message ? err.message : String(err);
  return msg.split('\n')[0].trim();
}

module.exports = { PackagerError, firstLine };
