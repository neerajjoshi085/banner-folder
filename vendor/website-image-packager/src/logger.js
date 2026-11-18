'use strict';

const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

function createLogger({ level = 'info', stream = process.stderr } = {}) {
  const current = LEVELS[level] !== undefined ? LEVELS[level] : LEVELS.info;
  const make = (lvl, prefix) => (...args) => {
    if (LEVELS[lvl] <= current) stream.write(prefix + args.join(' ') + '\n');
  };
  return {
    level,
    error: make('error', 'Error: '),
    warn: make('warn', 'Warning: '),
    info: make('info', ''),
    step: make('info', '> '),
    debug: make('debug', '  . '),
  };
}

const silentLogger = createLogger({ level: 'silent' });

module.exports = { createLogger, silentLogger };
