const devices={
  phone:{width:390,height:844,label:'390 × 844'},
  tablet:{width:834,height:1112,label:'834 × 1112'},
  monitor:{width:1440,height:900,label:'1440 × 900'}
};
const workspace=document.querySelector('#workspace');
const stage=document.querySelector('#stage');
const device=document.querySelector('#device');
const frame=document.querySelector('#app');
const meta=document.querySelector('#meta');
let selected=localStorage.getItem('chatx.preview.device')||'monitor';

function fit(){
  const spec=devices[selected];
  const availableWidth=Math.max(320,workspace.clientWidth-24);
  const availableHeight=Math.max(420,workspace.clientHeight-24);
  const scale=Math.min(1,availableWidth/(spec.width+20),availableHeight/(spec.height+20));
  device.style.width=spec.width+'px';
  device.style.height=spec.height+'px';
  device.style.transform=`translateX(-50%) scale(${scale})`;
  device.className=selected;
  stage.style.width=(spec.width*scale+20)+'px';
  stage.style.height=(spec.height*scale+20)+'px';
  meta.textContent=`${spec.label} · ${Math.round(scale*100)}%`;
}
function selectDevice(name){
  selected=name;
  localStorage.setItem('chatx.preview.device',name);
  document.querySelectorAll('[data-device]').forEach(button=>button.classList.toggle('active',button.dataset.device===name));
  fit();
}
document.querySelectorAll('[data-device]').forEach(button=>button.addEventListener('click',()=>selectDevice(button.dataset.device)));
document.querySelector('#reload').addEventListener('click',()=>frame.contentWindow.location.reload());
window.addEventListener('resize',fit);
selectDevice(selected);
