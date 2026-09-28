'use strict';
const assert=require('assert'),fs=require('fs');
function verify(source){
  assert(!/\$\{[^}\n]*\.grade[^}\n]*\}급/.test(source),'grade display must not append 급');
  assert(!/v\s*\+\s*['"]급['"]/.test(source),'grade choices must use alphabet only');
}
for(const file of ['js/roster-image-import.js','js/daily.js','js/team.js','js/skill-review.js','js/club-skill-review.js','rsvp.html'])verify(fs.readFileSync(file,'utf8'));
assert.throws(()=>verify('${p.grade}급'),'suffix mutation must fail');
assert.throws(()=>verify("v+'급'"),'choice mutation must fail');
console.log('grade alphabet labels and suffix mutations passed');
