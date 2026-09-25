'use strict';
const { inspect } = require('./_pptx');
module.exports = deliverable => {
  try { inspect(deliverable); return { passed: true }; }
  catch (error) { return { passed: false, detail: error.message, location: 'pptx' }; }
};
