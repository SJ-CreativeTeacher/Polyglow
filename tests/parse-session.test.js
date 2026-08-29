const test=require("node:test");
const assert=require("node:assert/strict");
const handler=require("../api/parse-session");

const validDraft={date:"2026-08-29",languageId:"es",durationMinutes:30,activityId:"integrated-learning",subcategoryId:"app",tutorName:null,topic:"путешествия",skills:["reading","listening","vocabulary"],notes:"Duolingo"};
const completion=content=>({choices:[{message:{content}}]});
const mockFetch=(status,payload)=>async()=>({ok:status>=200&&status<300,status,text:async()=>typeof payload==="string"?payload:JSON.stringify(payload)});
const request=fetchImpl=>handler.requestDraft({fetchImpl,key:"test-key-never-logged",model:"openrouter/free",description:"safe test description",uiLanguage:"ru",clientDate:"2026-08-29"});

test("accepts a successful JSON completion",async()=>{
  const result=await request(mockFetch(200,completion(JSON.stringify(validDraft))));
  assert.equal(result.ok,true);
  assert.deepEqual(result.draft,validDraft);
});

test("extracts JSON from a markdown block",async()=>{
  const content=`Here is the result:\n\`\`\`json\n${JSON.stringify(validDraft)}\n\`\`\``;
  const result=await request(mockFetch(200,completion(content)));
  assert.equal(result.ok,true);
  assert.equal(result.draft.languageId,"es");
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
  assert.deepEqual(handler.missingFields(draft),["date","languageId","durationMinutes","activityId"]);
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
