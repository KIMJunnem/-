'use strict';

const fs = require('node:fs');
const vm = require('node:vm');

for (const file of ['dist/index.html', 'dist/soomgo-workflow.html']) {
  const html = fs.readFileSync(file, 'utf8');
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  for (const [index, match] of scripts.entries()) {
    const type = match[0].match(/\btype=["']([^"']+)["']/i)?.[1] || 'text/javascript';
    if (/javascript|module|ecmascript/i.test(type)) new vm.Script(match[1], { filename: `${file}#script-${index + 1}` });
  }
  console.log(`${file}: ${scripts.length} inline script(s) parsed`);
}
