const gate=document.getElementById('universe-gate');
const originalHeader=document.querySelector('.topbar'), originalMain=document.querySelector('main'), originalFooter=document.querySelector('footer');
let btsData={concerts:[]}; const STORAGE_KEY='arirang-quest-archive-v1';
function loadBts(){try{const value=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}');btsData.concerts=Array.isArray(value.concerts)?value.concerts:[]}catch{btsData={concerts:[]}}}
function saveBts(){localStorage.setItem(STORAGE_KEY,JSON.stringify(btsData))}
function esc(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function backToGate(){gate.hidden=false;document.body.classList.remove('quest-mode');document.body.classList.remove('bts-universe');document.dispatchEvent(new CustomEvent('music-universe-change',{detail:{universe:'mcr'}}))}
function chooseUniverse(universe){gate.hidden=true;document.body.classList.remove('quest-mode');document.body.classList.toggle('bts-universe',universe==='bts');document.dispatchEvent(new CustomEvent('music-universe-change',{detail:{universe}}))}

document.getElementById('choose-mcr').addEventListener('click',()=>chooseUniverse('mcr'));document.getElementById('choose-bts').addEventListener('click',()=>chooseUniverse('bts'));
const switchButton=document.createElement('button');switchButton.className='universe-switch';switchButton.type='button';switchButton.textContent='↗ CAMBIAR UNIVERSO';switchButton.onclick=()=>{gate.hidden=false;document.body.classList.remove('bts-universe');};document.querySelector('.topbar').appendChild(switchButton);