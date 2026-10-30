(()=>{
'use strict';
const slug=document.body.dataset.demo;
const signal=document.querySelector('#signal'),target=document.querySelector('#target-pane');
const replay=document.querySelector('#replay'),pause=document.querySelector('#pause'),loop=document.querySelector('#loop'),reduce=document.querySelector('#reduce'),mode=document.querySelector('#mode');
const mq=matchMedia('(prefers-reduced-motion: reduce)');
let animations=[],timer=null,userPaused=false,manualReduced=false,runs=0;
const reduced=()=>mq.matches||manualReduced;
const visible=()=>document.visibilityState==='visible';
function clearTimer(){if(timer!==null){clearTimeout(timer);timer=null;}}
function cancelAnimations(){animations.forEach(a=>a.cancel());animations=[];}
function announce(){mode.textContent=reduced()?'Reduced motion · state shown without movement':!visible()?'Hidden · animation and timer paused':userPaused?'Preview paused':loop.checked?'Repeating while visible':'One-shot preview · repeat is off';}
function animate(el,frames,duration,options={}){if(reduced()||!visible()||userPaused)return;const a=el.animate(frames,{duration,easing:'cubic-bezier(.2,.8,.2,1)',...options});animations.push(a);}
function finalState(){signal.className='state '+({working:'working','needs-you':'waiting',unread:'unread',memory:'working',pane:''}[slug]);signal.textContent={working:'Working','needs-you':'Needs you',unread:'Unread',memory:'Working',pane:'Ready'}[slug];}
function updateCounts(){const states=[...document.querySelectorAll('.pane-header .state')];const spans=document.querySelectorAll('.attention>span');['waiting','unread','working'].forEach((state,i)=>{spans[i].textContent=states.filter(el=>el.classList.contains(state)).length+' '+['needs you','unread','working'][i];});}
function schedule(){clearTimer();if(loop.checked&&visible()&&!userPaused&&!reduced())timer=setTimeout(()=>{timer=null;run();},6000);}
function run(){clearTimer();cancelAnimations();finalState();updateCounts();runs++;
if(slug==='working')document.querySelectorAll('#working-dots i').forEach((dot,i)=>animate(dot,[{opacity:.35,transform:'translateY(0)'},{opacity:1,transform:'translateY(-2px)',offset:.4},{opacity:.35,transform:'translateY(0)'}],1100,{delay:i*120,iterations:3,easing:'ease-in-out'}));
if(slug==='needs-you')animate(signal,[{opacity:0,transform:'translateY(4px) scale(.96)'},{opacity:1,transform:'translateY(0) scale(1)'}],520);
if(slug==='unread')animate(signal,[{opacity:0,transform:'translateY(-3px)'},{opacity:1,transform:'translateY(0)'}],420);
if(slug==='memory')animate(document.querySelector('#receipt'),[{opacity:0,transform:'translateX(-8px)'},{opacity:1,transform:'translateX(0)'}],640);
if(slug==='pane')animate(target.querySelector('.pane-header'),[{opacity:0,transform:'translateY(-4px)'},{opacity:1,transform:'translateY(0)'}],320);
schedule();announce();}
function sync(){clearTimer();if(reduced()){cancelAnimations();finalState();}else animations.forEach(a=>{if(a.playState==='finished'||a.playState==='idle')return;if(!visible()||userPaused)a.pause();else a.play();});schedule();announce();}
replay.addEventListener('click',run);pause.addEventListener('click',()=>{userPaused=!userPaused;pause.textContent=userPaused?'Resume preview':'Pause preview';pause.setAttribute('aria-pressed',String(userPaused));sync();});loop.addEventListener('change',()=>{schedule();announce();});reduce.addEventListener('change',()=>{manualReduced=reduce.checked;sync();});mq.addEventListener('change',sync);document.addEventListener('visibilitychange',sync);window.addEventListener('pagehide',()=>{clearTimer();cancelAnimations();});window.addEventListener('pageshow',sync);
// Read-only diagnostics for the local verification script. No application integration.
window.motionDiagnostics=()=>({slug,runs,reduced:reduced(),visible:visible(),userPaused,timerPending:timer!==null,animations:animations.map(a=>({state:a.playState,time:a.currentTime,keyframes:a.effect.getKeyframes()}))});
run();
})();
