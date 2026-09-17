import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OpenAITranscriptionProvider,
  OpenAIMeetingSummaryProvider,
  createConfiguredMeetingProviders,
} from '../src/meeting/openai-providers.js';

const jsonResponse=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json',...headers}});

test('OpenAI diarization adapter sends the documented transcription contract and preserves timecoded speaker segments',async()=>{
  let request;
  const fetchImpl=async(url,options)=>{
    request={url,options};
    return jsonResponse({
      task:'transcribe',
      duration:12.4,
      text:'Первый фрагмент. Второй фрагмент.',
      segments:[
        {id:'seg-a',type:'transcript.text.segment',start:0.25,end:4.8,speaker:'A',text:'Первый фрагмент.'},
        {id:'seg-b',type:'transcript.text.segment',start:5,end:12.4,speaker:'B',text:'Второй фрагмент.'},
      ],
      usage:{type:'duration',seconds:12.4},
    },200,{'x-request-id':'req_transcription_fixture'});
  };
  const provider=new OpenAITranscriptionProvider({apiKey:'test-key',fetchImpl,language:'ru'});
  const result=await provider.transcribe({body:Buffer.from('fixture-media'),storageKey:'recordings/test.mp4'});
  assert.equal(request.url,'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(request.options.method,'POST');
  assert.equal(request.options.headers.authorization,'Bearer test-key');
  const form=request.options.body;
  assert.equal(form.get('model'),'gpt-4o-transcribe-diarize');
  assert.equal(form.get('response_format'),'diarized_json');
  assert.equal(form.get('chunking_strategy'),'auto');
  assert.equal(form.get('language'),'ru');
  assert.equal(form.get('file').name,'meeting.mp4');
  assert.equal(result.provider,'openai');
  assert.equal(result.requestId,'req_transcription_fixture');
  assert.deepEqual(result.usage,{type:'duration',seconds:12.4});
  assert.equal(result.segments.length,2);
  assert.deepEqual(result.segments.map((segment)=>[segment.startMs,segment.endMs,segment.speakerLabel,segment.providerSegmentId]),[
    [250,4800,'A','seg-a'],[5000,12400,'B','seg-b'],
  ]);
});

test('OpenAI summary adapter uses Responses structured output, disables response storage and cites transcript IDs',async()=>{
  let requestBody;
  const fetchImpl=async(url,options)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');
    requestBody=JSON.parse(options.body);
    return jsonResponse({
      id:'resp_fixture',
      output_text:JSON.stringify({
        overview:'Команда согласовала проверку релиза.',
        proposals:[{
          proposalType:'action',
          title:'Проверить релиз',
          body:'Закрыть mobile QA.',
          proposedOwnerId:null,
          proposedDueAt:null,
          confidence:0.96,
          sourceSegmentIds:['segment-1'],
        }],
      }),
      usage:{input_tokens:100,output_tokens:50,total_tokens:150},
    },200,{'x-request-id':'req_summary_fixture'});
  };
  const provider=new OpenAIMeetingSummaryProvider({apiKey:'test-key',fetchImpl});
  const result=await provider.summarize({
    callId:'call-1',
    segments:[{id:'segment-1',startMs:1000,endMs:5000,speakerLabel:'A',speakerUserId:null,text:'Нужно проверить релиз.'}],
  });
  assert.equal(requestBody.model,'gpt-5.6');
  assert.equal(requestBody.store,false);
  assert.equal(requestBody.text.format.type,'json_schema');
  assert.equal(requestBody.text.format.strict,true);
  assert.match(requestBody.input,/\[segment-1\]/);
  assert.match(requestBody.instructions,/Do not invent decisions, actions, owners, deadlines/);
  assert.equal(result.requestId,'req_summary_fixture');
  assert.deepEqual(result.usage,{input_tokens:100,output_tokens:50,total_tokens:150});
  assert.equal(result.summaryJson.responseId,'resp_fixture');
  assert.equal(result.proposals[0].sourceSegmentIds[0],'segment-1');
});

test('provider selection is explicit and fails closed without credentials',()=>{
  const absent=createConfiguredMeetingProviders({});
  assert.equal(absent.transcriptionProvider,undefined);
  assert.equal(absent.summaryProvider,undefined);
  assert.equal(absent.status.openAIConfigured,false);

  const configured=createConfiguredMeetingProviders({
    MEETING_TRANSCRIPTION_PROVIDER:'openai',
    MEETING_SUMMARY_PROVIDER:'openai',
  });
  assert.equal(configured.transcriptionProvider.status().enabled,false);
  assert.equal(configured.summaryProvider.status().enabled,false);
  assert.equal(configured.transcriptionProvider.status().reason,'OPENAI_API_KEY is not configured');

  const enabled=createConfiguredMeetingProviders({
    OPENAI_API_KEY:'test-key',
    MEETING_TRANSCRIPTION_PROVIDER:'openai',
    MEETING_SUMMARY_PROVIDER:'openai',
  });
  assert.equal(enabled.transcriptionProvider.status().enabled,true);
  assert.equal(enabled.summaryProvider.status().enabled,true);
});

test('provider HTTP errors remain structured and retain provider request IDs',async()=>{
  const transcription=new OpenAITranscriptionProvider({
    apiKey:'test-key',
    fetchImpl:async()=>jsonResponse({error:{message:'unsupported media',type:'invalid_request_error',code:'bad_media'}},400,{'x-request-id':'req_bad_media'}),
  });
  await assert.rejects(
    ()=>transcription.transcribe({body:Buffer.from('bad'),storageKey:'bad.mp4'}),
    (error)=>error.code==='OPENAI_TRANSCRIPTION_FAILED'
      &&error.statusCode===400
      &&error.details?.providerCode==='bad_media'
      &&error.details?.requestId==='req_bad_media',
  );

  const summary=new OpenAIMeetingSummaryProvider({
    apiKey:'test-key',
    fetchImpl:async()=>jsonResponse({error:{message:'provider unavailable'}},503,{'x-request-id':'req_summary_fail'}),
  });
  await assert.rejects(
    ()=>summary.summarize({callId:'call',segments:[{id:'s',startMs:0,endMs:1,text:'x'}]}),
    (error)=>error.code==='OPENAI_SUMMARY_FAILED'
      &&error.statusCode===502
      &&error.details?.requestId==='req_summary_fail',
  );
});
