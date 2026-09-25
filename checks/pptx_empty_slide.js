'use strict';
const { inspect } = require('./_pptx');
module.exports = deliverable => {
  try {
    const { slides } = inspect(deliverable);
    for (let index = 0; index < slides.length; index += 1) {
      const xml = slides[index][1].toString('utf8');
      if (!/<a:t(?:\s[^>]*)?>[\s\S]*?<\/a:t>|<p:pic(?:\s|>)|<p:graphicFrame(?:\s|>)/i.test(xml)) {
        return { passed: false, detail: `빈 슬라이드가 발견되었습니다: ${index + 1}장`, location: `slide:${index + 1}` };
      }
    }
    return { passed: true };
  } catch (error) { return { passed: false, detail: error.message, location: 'pptx' }; }
};
