const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const handler=require("../api/parse-session");

const validDraft={date:"2026-08-29",languageId:"es",durationMinutes:30,activityId:"integrated-learning",subcategoryId:"app",tutorName:null,topic:"путешествия",skills:["reading","listening","vocabulary"],notes:"Duolingo"};
const completion=content=>({choices:[{message:{content}}]});
const mockFetch=(status,payload)=>async()=>({ok:status>=200&&status<300,status,text:async()=>typeof payload==="string"?payload:JSON.stringify(payload)});
const request=fetchImpl=>handler.requestDraft({fetchImpl,key:"test-key-never-logged",model:"openrouter/free",description:"safe test description",uiLanguage:"ru",clientDate:"2026-08-29"});

test("accepts a successful JSON completion",async()=>{
  const result=await request(mockFetch(200,completion(JSON.stringify({sessions:[{...validDraft,dateExplicit:true,detectedLanguageIds:["es"],ambiguousFields:[]}]}))));
  assert.equal(result.ok,true);
  assert.equal(result.sessions[0].languageId,"es");assert.equal(result.sessions[0].durationMinutes,30);assert.equal(result.sessions[0].activityId,"integrated-learning");
});

test("extracts JSON from a markdown block",async()=>{
  const content=`Here is the result:\n\`\`\`json\n${JSON.stringify({sessions:[{...validDraft,dateExplicit:false,detectedLanguageIds:["es"],ambiguousFields:[]}]})}\n\`\`\``;
  const result=await request(mockFetch(200,completion(content)));
  assert.equal(result.ok,true);
  assert.equal(result.sessions[0].languageId,"es");
});

test("rejects an empty provider response",async()=>{
  const result=await request(mockFetch(200,""));
  assert.deepEqual(result,{ok:false,status:502,code:"AI_INVALID_RESPONSE"});
});

test("rejects invalid model JSON",async()=>{
  const result=await request(mockFetch(200,completion("not JSON")));
  assert.deepEqual(result,{ok:false,status:502,code:"AI_INVALID_RESPONSE"});
});

test("maps a rejected fetch TypeError to provider unavailable",async()=>{
  const fetchError=Object.assign(new TypeError("fetch failed"),{cause:{code:"ECONNRESET"}});
  const result=await request(async()=>{throw fetchError;});
  assert.deepEqual(result,{ok:false,status:503,code:"AI_PROVIDER_UNAVAILABLE"});
});

test("maps an unreadable response body to provider unavailable",async()=>{
  const result=await request(async()=>({ok:true,status:200,text:async()=>{throw new TypeError("terminated");}}));
  assert.deepEqual(result,{ok:false,status:503,code:"AI_PROVIDER_UNAVAILABLE"});
});

for(const [status,code,clientStatus] of [[401,"AI_AUTH_ERROR",502],[402,"AI_RATE_LIMITED",429],[403,"AI_AUTH_ERROR",502],[429,"AI_RATE_LIMITED",429],[500,"AI_PROVIDER_UNAVAILABLE",503],[502,"AI_PROVIDER_UNAVAILABLE",503],[503,"AI_PROVIDER_UNAVAILABLE",503]]){
  test(`maps OpenRouter ${status} to ${code}`,async()=>{
    const result=await request(mockFetch(status,{error:{code:`provider_${status}`,message:"Safe provider message"}}));
    assert.deepEqual(result,{ok:false,status:clientStatus,code});
  });
}

test("reports missing environment variables without calling fetch",async()=>{
  const previousKey=process.env.OPENROUTER_API_KEY,previousModel=process.env.OPENROUTER_MODEL;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_MODEL;
  const response={statusCode:0,headers:{},payload:null,status(value){this.statusCode=value;return this;},setHeader(name,value){this.headers[name]=value;return this;},json(value){this.payload=value;return this;}};
  try{
    await handler({method:"POST",headers:{"content-type":"application/json"},body:{description:"valid description",clientDate:"2026-08-29"}},response);
    assert.equal(response.statusCode,503);
    assert.deepEqual(response.payload,{ok:false,code:"AI_NOT_CONFIGURED"});
  }finally{
    if(previousKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=previousKey;
    if(previousModel===undefined)delete process.env.OPENROUTER_MODEL;else process.env.OPENROUTER_MODEL=previousModel;
  }
});

test("does not invent missing required session data",()=>{
  const draft=handler.normalizeDraft({topic:"Only a topic"});
  assert.equal(draft.date,null);
  assert.equal(draft.languageId,null);
  assert.equal(draft.durationMinutes,null);
  assert.equal(draft.activityId,null);
  assert.deepEqual(handler.missingFields(draft),["languageId","durationMinutes","activityId"]);
});

test("keeps an explicitly detected language outside the profile",()=>{
  const draft=handler.normalizeDraft({...validDraft,languageId:"es",detectedLanguageIds:["es"]});
  assert.equal(draft.languageId,"es");
  assert.deepEqual(draft.detectedLanguageIds,["es"]);
});

test("requires clarification when several languages are detected",()=>{
  const draft=handler.normalizeDraft({...validDraft,languageId:null,detectedLanguageIds:["es","en"],ambiguousFields:["languageId"],multipleSessions:true});
  assert.equal(draft.languageId,null);
  assert.equal(draft.multipleSessions,true);
  assert.deepEqual(handler.missingFields(draft),[]);
});

test("reports only missing required fields",()=>{
  assert.deepEqual(handler.missingFields(handler.normalizeDraft({languageId:"es",detectedLanguageIds:["es"],activityId:"reading"})),["durationMinutes"]);
  assert.deepEqual(handler.missingFields(handler.normalizeDraft({durationMinutes:30,activityId:"integrated-learning"})),["languageId"]);
  assert.deepEqual(handler.missingFields(handler.normalizeDraft({languageId:"de",detectedLanguageIds:["de"],durationMinutes:30})),["activityId"]);
});

test("returns needs_clarification instead of an error for incomplete input",()=>{
  const result=handler.clarificationResult(handler.normalizeDraft({detectedLanguageIds:[],ambiguousFields:[],multipleSessions:false}));
  assert.equal(result.status,"needs_clarification");
  assert.deepEqual(result.missingFields,["languageId","durationMinutes","activityId"]);
});

test("locally clarifies vague and partial descriptions without stale defaults",()=>{
  const vague=handler.localClarificationDraft("Сегодня немного позанималась","2026-08-30");assert.deepEqual(handler.missingFields(vague),["languageId","durationMinutes","activityId"]);assert.equal(vague.date,"2026-08-30");
  const reading=handler.localClarificationDraft("Сегодня читала на французском","2026-08-30");assert.equal(reading.languageId,"fr");assert.equal(reading.activityId,"reading");assert.deepEqual(handler.missingFields(reading),["durationMinutes"]);
});

test("creates separate English and French session drafts",()=>{
  const sessions=handler.localSessionDrafts("Сегодня 20 минут читала по-английски, а затем 15 минут занималась французским в приложении.","2026-08-30");
  assert.equal(sessions.length,2);assert.deepEqual(sessions.map(item=>[item.languageId,item.durationMinutes,item.activityId,item.subcategoryId]),[["en",20,"reading",null],["fr",15,"integrated-learning","app"]]);
});

test("creates the same English and French sessions from English text",()=>{
  const sessions=handler.localSessionDrafts("I read in English for 20 minutes and then studied French in Duolingo for 15 minutes.","2026-08-30");
  assert.equal(sessions.length,2);assert.deepEqual(sessions.map(item=>[item.languageId,item.durationMinutes,item.activityId,item.subcategoryId]),[["en",20,"reading",null],["fr",15,"integrated-learning","app"]]);
});

test("recognizes a Spanish Duolingo session",()=>{
  const sessions=handler.localSessionDrafts("Сегодня 30 минут занималась испанским в Duolingo.","2026-08-30");
  assert.equal(sessions.length,1);assert.deepEqual([sessions[0].languageId,sessions[0].durationMinutes,sessions[0].activityId,sessions[0].subcategoryId],["es",30,"integrated-learning","app"]);
});

test("keeps the second session duration empty when only the first is timed",()=>{
  const sessions=handler.localSessionDrafts("Сегодня 20 минут читала на английском, а затем занималась французским.","2026-08-30");
  assert.equal(sessions.length,2);assert.deepEqual(sessions.map(item=>item.durationMinutes),[20,null]);assert.deepEqual(sessions[1].missingFields,["durationMinutes","activityId"]);
});

test("does not assign one trailing duration to two coordinated languages",()=>{
  const sessions=handler.localSessionDrafts("Сегодня читала на английском и французском 20 минут.","2026-08-30");
  assert.equal(sessions.length,2);assert.deepEqual(sessions.map(item=>item.durationMinutes),[null,null]);assert.ok(sessions.every(item=>item.missingFields.includes("durationMinutes")));
});

test("recognizes half an hour in a German learning app",()=>{
  const sessions=handler.localSessionDrafts("Полчаса занималась немецким в приложении.","2026-08-30");
  assert.equal(sessions.length,1);assert.deepEqual([sessions[0].languageId,sessions[0].durationMinutes,sessions[0].activityId,sessions[0].subcategoryId],["de",30,"integrated-learning","app"]);
});

test("recognizes two hours of watching a series",()=>{
  const sessions=handler.localSessionDrafts("Сегодня два часа смотрела сериал на английском.","2026-08-30");
  assert.equal(sessions.length,1);assert.deepEqual([sessions[0].languageId,sessions[0].durationMinutes,sessions[0].activityId,sessions[0].subcategoryId],["en",120,"watching","series"]);
});

test("recognizes English word hours and watching",()=>{
  const sessions=handler.localSessionDrafts("I watched a series in English for two hours.","2026-08-30");
  assert.equal(sessions.length,1);assert.deepEqual([sessions[0].languageId,sessions[0].durationMinutes,sessions[0].activityId,sessions[0].subcategoryId],["en",120,"watching","series"]);
});

test("reconciles an inaccurate successful model response with explicit text evidence",async()=>{
  const description="Сегодня 20 минут читала по-английски, а затем 15 минут занималась французским в приложении.";
  const model={sessions:[{...validDraft,dateExplicit:false,languageId:"en",detectedLanguageIds:["en"],durationMinutes:null,activityId:"reading",subcategoryId:"book",ambiguousFields:["durationMinutes"]},{...validDraft,dateExplicit:false,languageId:"fr",detectedLanguageIds:["fr"],durationMinutes:null,activityId:"reading",subcategoryId:"book",ambiguousFields:["durationMinutes"]}]};
  const result=await handler.requestDraft({fetchImpl:mockFetch(200,completion(JSON.stringify(model))),key:"test-key-never-logged",model:"openrouter/free",description,uiLanguage:"ru",clientDate:"2026-08-30"});
  assert.equal(result.ok,true);assert.deepEqual(result.sessions.map(item=>[item.languageId,item.durationMinutes,item.activityId,item.subcategoryId]),[["en",20,"reading",null],["fr",15,"integrated-learning","app"]]);assert.ok(result.sessions.every(item=>!item.missingFields.includes("durationMinutes")));
});

test("keeps correct model durations when the text confirms them",()=>{
  const description="I read in English for 20 minutes and then studied French in Duolingo for 15 minutes.";
  const model=[{...validDraft,dateExplicit:false,languageId:"en",detectedLanguageIds:["en"],durationMinutes:20,activityId:"reading",subcategoryId:null,ambiguousFields:[]},{...validDraft,dateExplicit:false,languageId:"fr",detectedLanguageIds:["fr"],durationMinutes:15,activityId:"integrated-learning",subcategoryId:"app",ambiguousFields:[]}];
  const sessions=handler.reconcileSessions(description,model,"2026-08-30");
  assert.deepEqual(sessions.map(item=>item.durationMinutes),[20,15]);
});

test("does not divide shared time between languages",()=>{
  const sessions=handler.localSessionDrafts("Час занималась английским и французским","2026-08-30");assert.equal(sessions.length,2);assert.deepEqual(sessions.map(item=>item.durationMinutes),[null,null]);
});

test("applies an explicit each-duration to every language",()=>{
  const sessions=handler.localSessionDrafts("По 20 минут занималась английским и французским","2026-08-30");assert.equal(sessions.length,2);assert.deepEqual(sessions.map(item=>item.durationMinutes),[20,20]);
});

test("Russian description creates only the studied English session",()=>{
  const sessions=handler.localSessionDrafts("Сегодня 20 минут читала по-английски","2026-08-30");assert.equal(sessions.length,1);assert.equal(sessions[0].languageId,"en");
});

test("creates two explicitly separate English sessions",()=>{
  const sessions=handler.localSessionDrafts("20 минут читала по-английски и 15 минут занималась английским в приложении","2026-08-30");assert.equal(sessions.length,2);assert.deepEqual(sessions.map(item=>item.languageId),["en","en"]);
});

test("does not create a card for a language mentioned only as a topic",()=>{
  const sessions=handler.localSessionDrafts("20 минут читала по-английски о французском искусстве","2026-08-30");assert.equal(sessions.length,1);assert.equal(sessions[0].languageId,"en");
});

test("keeps missing fields independent per session",()=>{
  const complete=handler.prepareSession({languageId:"en",detectedLanguageIds:["en"],durationMinutes:20,activityId:"reading",ambiguousFields:[],dateExplicit:false},"2026-08-30");const partial=handler.prepareSession({languageId:"fr",detectedLanguageIds:["fr"],durationMinutes:null,activityId:"integrated-learning",subcategoryId:"app",ambiguousFields:[],dateExplicit:false},"2026-08-30");assert.deepEqual(complete.missingFields,[]);assert.deepEqual(partial.missingFields,["durationMinutes"]);
});

test("ignores a model date unless it was explicitly stated",()=>{
  assert.equal(handler.normalizeDraft({...validDraft,date:"2026-08-25",dateExplicit:false}).date,null);assert.equal(handler.normalizeDraft({...validDraft,date:"2026-08-25",dateExplicit:true}).date,"2026-08-25");
});

test("client resets draft and clarification before sequential AI requests",()=>{
  const source=fs.readFileSync(path.join(__dirname,"../assets/js/app.js"),"utf8");
  assert.match(source,/function resetAIRequestState\(\)\{aiDraft=\[\];/);
  assert.match(source,/aiDirty=true;resetAIRequestState\(\);setAIView\("loading"\)/);
  assert.match(source,/ai-description"\)\.addEventListener\("input"[^\n]*clearAIError/);
  assert.match(source,/if\(aiSaving\)return;const sessions=buildAISessions\(\)/);
  assert.match(source,/\[404,405,501\]\.includes\(response\.status\)/);
  assert.match(source,/localServerError\?"ai\.localServer"/);
});

test("client clears completed live states and counts filtered active languages",()=>{
  const source=fs.readFileSync(path.join(__dirname,"../assets/js/app.js"),"utf8");
  assert.match(source,/loadingText\.textContent=view==="loading"\?t\("ai\.loading"\):""/);
  assert.match(source,/function clearAIError\(\)\{aiErrorKey=null;[^\n]*error\.textContent=""/);
  assert.match(source,/new Set\(sessions\.map\(item=>item\.languageId\)\.filter\(Boolean\)\)\.size/);
});

test("normalizes an API key with a trailing newline",()=>{
  assert.equal(handler.normalizeApiKey("sk-or-test\n"),"sk-or-test");
  assert.equal(handler.validApiKey(handler.normalizeApiKey("sk-or-test\n")),true);
});

test("normalizes an API key with CRLF",()=>{
  assert.equal(handler.normalizeApiKey("sk-or-\r\ntest"),"sk-or-test");
});

test("trims spaces around an API key",()=>{
  assert.equal(handler.normalizeApiKey("  sk-or-test  "),"sk-or-test");
});

test("removes an accidental Bearer prefix",()=>{
  assert.equal(handler.normalizeApiKey("Bearer sk-or-test"),"sk-or-test");
});

test("rejects an API key with an internal control character",()=>{
  const key=handler.normalizeApiKey("sk-or-\u0001test");
  assert.equal(handler.validApiKey(key),false);
});

test("returns invalid configuration before fetch for a malformed key",async()=>{
  const previousKey=process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY="sk-or-\u0001test";
  const response={statusCode:0,headers:{},payload:null,status(value){this.statusCode=value;return this;},setHeader(name,value){this.headers[name]=value;return this;},json(value){this.payload=value;return this;}};
  try{
    await handler({method:"POST",headers:{"content-type":"application/json"},body:{description:"valid description",clientDate:"2026-08-29"}},response);
    assert.equal(response.statusCode,503);
    assert.deepEqual(response.payload,{ok:false,code:"AI_INVALID_CONFIGURATION"});
  }finally{if(previousKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=previousKey;}
});

test("trims the configured model name",()=>{
  assert.equal(handler.normalizeModel("  openrouter/free\r\n"),"openrouter/free");
});
