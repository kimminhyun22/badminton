'use strict';
/**
 * 2026-09-23 운영자: 라이브 중 「선수 추가」는 운영 도구 줄이 아니라
 * 인원 현황의 「도착 전」 옆 빈칸에서 바로 실행한다.
 *
 * 훼손 시험: DAILY_HEADCOUNT_ADD_SOURCE_ROOT=<사본> node 이 파일
 */
const assert=require('assert');
const fs=require('fs');
const path=require('path');

const root=process.env.DAILY_HEADCOUNT_ADD_SOURCE_ROOT
  ?path.resolve(process.env.DAILY_HEADCOUNT_ADD_SOURCE_ROOT)
  :path.join(__dirname,'..');
const src=fs.readFileSync(path.join(root,'js','daily.js'),'utf8');
const css=fs.readFileSync(path.join(root,'css','app.css'),'utf8');

const headcount=src.slice(src.indexOf('function dailyRenderHeadcount('),src.indexOf('function _dailyLiveAdditionRows('));
const tools=src.slice(src.indexOf('function _dailyPlayerToolsHtml('),src.indexOf('function dailyOpenCourtSetting('));

assert(headcount.includes("{label:'선수 추가',value:'＋',action:'dailyImportRoster()',cls:'add-player'}"),
  '라이브 인원 현황에 선수 추가 버튼이 있어야 합니다.');
assert(headcount.indexOf("label:'도착 전'")<headcount.indexOf("label:'선수 추가'"),
  '선수 추가는 도착 전 다음에 배치되어야 합니다.');
assert(headcount.includes("const live=_dailyUiStage()==='live';")&&headcount.includes('? [...cards,'),
  '선수 추가 상태 카드는 라이브 중에만 보여야 합니다.');
assert(headcount.includes("const onclick=card.action||`dailyOpenPlayerStatus('${card.filter}')`;"),
  '숫자 카드는 상태 필터를, 선수 추가 카드는 참가자 등록을 열어야 합니다.');
assert(!tools.includes("act('dailyImportRoster()'"),
  '경기 운영 도구 줄에 선수 추가를 중복 노출하면 안 됩니다.');
assert(css.includes('.daily-headcount{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));'),
  '넓은 화면에서는 상태 7칸과 선수 추가가 한 줄이어야 합니다.');
assert(css.includes('.daily-headcount-item.add-player{grid-column:span 2;}'),
  '좁은 3열 화면에서는 선수 추가가 도착 전 옆 두 칸을 채워야 합니다.');

console.log('daily headcount add-player regression passed');
