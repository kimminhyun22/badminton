#!/usr/bin/env node
'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');

const root=path.resolve(__dirname,'..');
const docsDir=path.join(root,'docs','public-rollout');
const data=JSON.parse(fs.readFileSync(path.join(docsDir,'roadmap.json'),'utf8'));
const template=fs.readFileSync(path.join(docsDir,'roadmap.template.html'),'utf8');
const html=fs.readFileSync(path.join(docsDir,'ROADMAP.html'),'utf8');
const validStatuses=new Set(['done','in_progress','waiting','later','blocked']);

assert(data.updated&&data.title&&data.goal&&data.current&&data.next,
  '로드맵의 갱신일·제목·목표·현재·다음 행동이 모두 있어야 합니다.');
assert(Array.isArray(data.criteria)&&data.criteria.length>=5,
  '관찰 가능한 완료 기준이 충분히 있어야 합니다.');
assert(Array.isArray(data.stages)&&data.stages.length>=5,
  '공개 배포 단계를 축약해 핵심 게이트를 잃으면 안 됩니다.');

const ids=new Set();
for(const stage of data.stages){
  assert(stage.id&&!ids.has(stage.id),`단계 id가 없거나 중복입니다: ${stage.id||'(없음)'}`);
  ids.add(stage.id);
  assert(stage.name&&stage.state&&stage.owner,`${stage.id} 단계의 이름·상태·담당이 필요합니다.`);
  assert(Array.isArray(stage.items)&&stage.items.length,`${stage.id} 단계에 작업이 없습니다.`);
  for(const item of stage.items){
    assert(item.name&&item.detail,`${stage.id} 단계 작업의 이름·설명이 필요합니다.`);
    assert(validStatuses.has(item.status),`${item.name}의 상태값 ${item.status}은 지원하지 않습니다.`);
    if(item.evidence){
      assert(fs.existsSync(path.resolve(docsDir,item.evidence)),`${item.name}의 근거 파일이 없습니다: ${item.evidence}`);
    }
  }
}

const serialized=JSON.stringify(data).replaceAll('<','\\u003c');
assert.strictEqual(html,template.replace('__ROADMAP_DATA__',serialized),
  'ROADMAP.html이 roadmap.json 최신 내용과 다릅니다. 빌드 스크립트를 실행하세요.');
assert(!/%\s*(완료|진행)|완성률/.test(html),
  '근거 없는 완료율을 현황판에 표시하면 안 됩니다.');
assert(html.includes('id="next"')&&html.includes('id="criteria"')&&html.includes('id="risks"'),
  '목표 달성에 필요한 다음 행동·완료 기준·위험 영역이 모두 보여야 합니다.');

console.log(`public roadmap regression: 통과 (${data.stages.length}단계)`);
