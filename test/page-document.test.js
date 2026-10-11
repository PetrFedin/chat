import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePageDocument, plainTextPageDocument } from '../src/wiki/page-document.js';

test('structured Pages normalize rich content and derive a search projection',()=>{
  const doc={type:'doc',content:[
    {type:'heading',attrs:{level:2},content:[{type:'text',text:'Roadmap',marks:[{type:'bold'}]}]},
    {type:'paragraph',content:[{type:'text',text:'Source',marks:[{type:'link',attrs:{href:'https://example.com'}}]}]},
    {type:'bulletList',content:[{type:'listItem',content:[{type:'paragraph',content:[{type:'text',text:'Item'}]}]}]},
  ]};
  const result=normalizePageDocument(doc);
  assert.equal(result.content,'Roadmap\nSource\nItem');
  assert.deepEqual(result.document,doc);
  assert.equal(plainTextPageDocument('Hello\nworld').content.length,2);
});

test('structured Pages reject XSS, unbounded and unknown nodes',()=>{
  const wrap=node=>({type:'doc',content:[{type:'paragraph',content:[node]}]});
  for(const href of ['javascript:alert(1)','data:text/html,x','https://example.com/"><img','//evil.example']){
    assert.throws(()=>normalizePageDocument(wrap({type:'text',text:'bad',marks:[{type:'link',attrs:{href}}]})));
  }
  assert.throws(()=>normalizePageDocument({type:'doc',content:[{type:'iframe',attrs:{src:'https://a'}}]}));
  assert.throws(()=>normalizePageDocument(wrap({type:'text',text:'x',attrs:{onclick:'alert(1)'}})));
  assert.throws(()=>normalizePageDocument(wrap({type:'text',text:'x'.repeat(100001)})));
});
