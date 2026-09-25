'use strict';
const { parse } = require('./_srt');
module.exports = deliverable => {
  const result = parse(deliverable);
  return result.error ? { passed: false, detail: result.error, location: 'srt' } : { passed: true };
};
