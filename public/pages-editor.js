/* ChatX Pages: canonical ProseMirror JSON rendering and zero-cost editing. */
function installChatXPages(){
  'use strict';
  // Zero external runtime dependencies. The JSON is compatible with the
  // server-side ProseMirror/Tiptap page document contract (migration 079).
  const markTags={bold:'strong',italic:'em',underline:'u',strike:'s',code:'code'};
  const tagsToMarks={B:'bold',STRONG:'bold',I:'italic',EM:'italic',U:'underline',S:'strike',STRIKE:'strike',DEL:'strike',CODE:'code'};
  const blockedTags=new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','IMG','SVG','MATH','FORM','INPUT','BUTTON','VIDEO','AUDIO']);
  const linkIsSafe=href=>typeof href==='string'&&href.length<=2048&&/^(https?:\/\/[^\s<>"']+|mailto:[^\s<>"']+|#\/[a-z0-9/_?=&.%-]+)$/i.test(href.trim());
  const elem=tag=>document.createElement(tag);
  function plainText(text){
    return {type:'doc',content:String(text||'').split('\n').map(line=>({
      type:'paragraph',...(line?{content:[{type:'text',text:line}]}:{})
    }))};
  }
  function documentNode(n,depth){
    if(!n||typeof n!=='object'||depth>20)return null;
    if(n.type==='text'){
      let child=document.createTextNode(String(n.text||''));
      for(const mark of n.marks||[]){
        if(!mark||typeof mark!=='object')continue;
        let wrapper=null;
        if(mark.type==='link'&&linkIsSafe(mark.attrs?.href)){
          wrapper=elem('a');wrapper.setAttribute('href',mark.attrs.href.trim());
          if(!mark.attrs.href.startsWith('#/')){
            wrapper.setAttribute('target','_blank');wrapper.setAttribute('rel','noopener noreferrer');
          }
        }else if(markTags[mark.type])wrapper=elem(markTags[mark.type]);
        if(wrapper){wrapper.append(child);child=wrapper}
      }
      return child;
    }
    if(n.type==='hardBreak')return elem('br');
    if(n.type==='horizontalRule')return elem('hr');
    const tag={
      paragraph:'p',heading:'h'+Number(n.attrs?.level),bulletList:'ul',
      orderedList:'ol',listItem:'li',blockquote:'blockquote',codeBlock:'pre'
    }[n.type];
    if(!tag||tag==='hNaN'||!/^(p|h[123]|ul|ol|li|blockquote|pre)$/.test(tag))return null;
    const root=elem(tag);
    if(n.type==='orderedList'){
      const start=n.attrs?.start;
      if(Number.isSafeInteger(start)&&start>1&&start<=100000)root.start=start;
    }
    if(n.type==='codeBlock'){
      const code=elem('code');
      code.textContent=(n.content||[]).filter(x=>x?.type==='text').map(x=>x.text).join('');
      root.append(code);return root;
    }
    for(const child of n.content||[]){
      const dom=documentNode(child,depth+1);
      if(dom)root.append(dom);
    }
    return root;
  }
  function render(root,doc){
    if(!root)return;
    root.replaceChildren();
    if(doc?.type!=='doc'||!Array.isArray(doc.content))return;
    for(const child of doc.content){
      const node=documentNode(child,0);
      if(node)root.append(node);
    }
  }
  function inlineChildren(parent){
    const out=[];
    function pushText(text,marks){
      if(!text)return;
      const obj={type:'text',text};
      if(marks.length)obj.marks=marks;
      const last=out[out.length-1];
      if(last?.type==='text'&&JSON.stringify(last.marks||[])===JSON.stringify(obj.marks||[]))last.text+=text;
      else out.push(obj);
    }
    function visit(child,marks){
      if(child.nodeType===Node.TEXT_NODE){pushText(child.nodeValue,marks);return}
      if(child.nodeType!==Node.ELEMENT_NODE)return;
      const tag=child.tagName;
      if(blockedTags.has(tag))return;
      if(tag==='BR'){out.push({type:'hardBreak'});return}
      let next=marks;
      if(tagsToMarks[tag]){
        const type=tagsToMarks[tag];
        if(!marks.some(m=>m.type===type))next=[...marks,{type}];
      }else if(tag==='A'&&linkIsSafe(child.getAttribute('href'))&&!marks.some(m=>m.type==='link')){
        next=[...marks,{type:'link',attrs:{href:child.getAttribute('href').trim()}}];
      }
      for(const grandChild of child.childNodes)visit(grandChild,next);
    }
    for(const child of parent.childNodes)visit(child,[]);
    return out;
  }
  function paragraph(inline){return {type:'paragraph',...(inline.length?{content:inline}:{})}}
  function blocks(parent){
    const out=[];
    for(const child of parent.childNodes){
      if(child.nodeType===Node.TEXT_NODE){
        if(child.nodeValue.trim())out.push(paragraph([{type:'text',text:child.nodeValue}]));
        continue;
      }
      if(child.nodeType!==Node.ELEMENT_NODE||blockedTags.has(child.tagName))continue;
      const tag=child.tagName;
      if(tag==='HR'){out.push({type:'horizontalRule'});continue}
      if(tag==='P'||/^H[123]$/.test(tag)){
        const content=inlineChildren(child);
        out.push(tag==='P'?paragraph(content):{type:'heading',attrs:{level:Number(tag[1])},...(content.length?{content}:{})});
        continue;
      }
      if(tag==='PRE'){
        const text=child.textContent||'';
        out.push({type:'codeBlock',...(text?{content:[{type:'text',text}]}:{})});
        continue;
      }
      if(tag==='BLOCKQUOTE'){
        out.push({type:'blockquote',content:blocks(child).filter(x=>['paragraph','heading','bulletList','orderedList','codeBlock'].includes(x.type))});
        continue;
      }
      if(tag==='UL'||tag==='OL'){
        const items=[];
        for(const li of child.children){
          if(li.tagName!=='LI')continue;
          // LI may contain naked text as produced by the browser. Wrap it in
          // the paragraph required by the canonical schema.
          const nested=[];
          const inlineHolder=elem('span');
          for(const part of li.childNodes){
            if(part.nodeType===Node.ELEMENT_NODE&&['UL','OL','P','BLOCKQUOTE','PRE'].includes(part.tagName)){
              if(inlineHolder.childNodes.length){
                nested.push(paragraph(inlineChildren(inlineHolder)));inlineHolder.replaceChildren();
              }
              const shell=elem('div');shell.append(part.cloneNode(true));
              nested.push(...blocks(shell));
            }else inlineHolder.append(part.cloneNode(true));
          }
          if(inlineHolder.childNodes.length)nested.push(paragraph(inlineChildren(inlineHolder)));
          const clean=nested.filter(x=>['paragraph','bulletList','orderedList','blockquote','codeBlock'].includes(x.type));
          items.push({type:'listItem',content:clean.length?clean:[paragraph([])]});
        }
        if(items.length){
          const type=tag==='UL'?'bulletList':'orderedList';
          const start=Number(child.getAttribute('start')||1);
          out.push({type,...(type==='orderedList'?{attrs:{start:Number.isSafeInteger(start)&&start>=1&&start<=100000?start:1}}:{}),content:items});
        }
        continue;
      }
      if(tag==='DIV'&&[...child.children].some(x=>/^(P|H[123]|UL|OL|BLOCKQUOTE|PRE|HR|DIV)$/.test(x.tagName))){
        out.push(...blocks(child));continue;
      }
      if(tag==='BR'){out.push(paragraph([]));continue}
      out.push(paragraph(inlineChildren(child)));
    }
    return out;
  }
  function read(root){return {type:'doc',content:blocks(root)}}
  function mount(root,doc,{onDirty}={}){
    if(!root)throw new Error('Pages editor element missing');
    root.setAttribute('contenteditable','true');
    root.setAttribute('role','textbox');root.setAttribute('aria-multiline','true');
    root.setAttribute('aria-label','Содержимое страницы');
    root.spellcheck=true;
    render(root,doc||plainText(''));
    if(!root.childNodes.length)root.append(elem('p'));
    let dirty=false;
    const change=()=>{dirty=true;onDirty?.()};
    const paste=event=>{
      event.preventDefault();
      const text=event.clipboardData?.getData('text/plain')||'';
      root.focus();
      document.execCommand('insertText',false,text);
      change();
    };
    const drop=event=>{event.preventDefault()};
    root.addEventListener('input',change);
    root.addEventListener('paste',paste);
    root.addEventListener('drop',drop);
    const toolbar=root.parentElement?.querySelector('.wiki-editor-toolbar');
    const preventBlur=event=>{if(event.pointerType!=='touch')event.preventDefault()};
    const run=event=>{
      const button=event.target.closest('[data-page-command]');
      if(!button)return;
      event.preventDefault();
      root.focus({preventScroll:true});
      const cmd=button.dataset.pageCommand;
      if(['h1','h2','h3','p','blockquote','pre'].includes(cmd)){
        document.execCommand('formatBlock',false,cmd==='blockquote'?'blockquote':cmd);
      }else if(cmd==='bullet')document.execCommand('insertUnorderedList');
      else if(cmd==='ordered')document.execCommand('insertOrderedList');
      else if(cmd==='rule')document.execCommand('insertHorizontalRule');
      else if(cmd==='undo'||cmd==='redo')document.execCommand(cmd);
      else if(cmd==='bold'||cmd==='italic'||cmd==='underline')document.execCommand(cmd);
      else if(cmd==='strike')document.execCommand('strikeThrough');
      else if(cmd==='link'){
        const href=window.prompt('Введите HTTP(S), mailto: или внутреннюю ссылку ChatX');
        if(href===null)return;
        if(!linkIsSafe(href)){window.alert('Недопустимый адрес ссылки');return}
        document.execCommand('createLink',false,href.trim());
      }else if(cmd==='code'){
        const value=window.getSelection()?.toString();
        if(!value)return;
        const safe=value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        document.execCommand('insertHTML',false,'<code>'+safe+'</code>');
      }
      change();
    };
    toolbar?.addEventListener('pointerdown',preventBlur);
    toolbar?.addEventListener('click',run);
    return {
      getDocument:()=>read(root),
      get dirty(){return dirty},
      setDocument(value){render(root,value);if(!root.childNodes.length)root.append(elem('p'));dirty=false},
      markClean(){dirty=false},
      destroy(){
        root.removeEventListener('input',change);
        root.removeEventListener('paste',paste);
        root.removeEventListener('drop',drop);
        toolbar?.removeEventListener('pointerdown',preventBlur);
        toolbar?.removeEventListener('click',run);
      }
    };
  }
  window.ChatXPages=Object.freeze({plainText,render,mount,read,linkIsSafe});
}
installChatXPages();
