'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {
  MODEL_NAME,MAX_IMAGES,participantImagePrompt,validateImages,analyzeParticipantImages
}=require('../functions/daily-image-import');

const index=fs.readFileSync(path.join(__dirname,'../functions/index.js'),'utf8');

(async()=>{
  assert.strictEqual(MODEL_NAME,'gemini-3.5-flash');
  assert.strictEqual(MAX_IMAGES,8);
  assert(participantImagePrompt().includes('게스트만 신청한 댓글 작성자는 넣지 마세요.'),
    '게스트 접수 댓글의 작성자를 자동 참석으로 세면 안 됩니다.');
  const image={mimeType:'image/jpeg',data:Buffer.from('fake-image').toString('base64')};
  assert.strictEqual(validateImages([image]).length,1);
  assert.throws(()=>validateImages([]),/invalid-images/);
  assert.throws(()=>validateImages(Array.from({length:9},()=>image)),/invalid-images/);
  assert.throws(()=>validateImages([{mimeType:'text/plain',data:image.data}]),/invalid-image/);

  let request=null;
  const expected={voteAttendees:[{name:'회원가'}],commentAttendees:[],guests:[],lateMentions:[],declaredVoteCount:1,warnings:[]};
  const result=await analyzeParticipantImages({
    images:[image],projectId:'test-project',accessToken:'test-token',
    fetchImpl:async(url,options)=>{
      request={url,options,body:JSON.parse(options.body)};
      return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify(expected)}]}}]})};
    }
  });
  assert.deepStrictEqual(result,expected);
  assert(request.url.includes('/locations/global/')&&request.url.includes(MODEL_NAME),'서버는 Agent Platform global 모델을 사용해야 합니다.');
  assert.strictEqual(request.options.headers.Authorization,'Bearer test-token');
  assert.strictEqual(request.body.contents[0].parts.length,2,'서버 지침과 이미지가 함께 전달되어야 합니다.');
  assert.strictEqual(request.body.generationConfig.responseMimeType,'application/json');
  assert(index.includes('exports.analyzeDailyParticipantScreenshots = onCall(IMAGE_ANALYSIS_OPTIONS'),
    '전용 callable 함수가 배포 목록에 있어야 합니다.');
  assert(index.includes('enforceAppCheck:true'),'캡처 분석 함수는 App Check 없는 호출을 거절해야 합니다.');
  assert(index.includes('request.app'),'함수 본문도 App Check 검증 사실을 확인해야 합니다.');
  console.log('daily image analysis function regression ok');
})().catch(error=>{console.error(error);process.exit(1);});
