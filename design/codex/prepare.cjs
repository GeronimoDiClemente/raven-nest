const fs=require('fs'),path=require('path');
const {JSDOM}=require('jsdom');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),icons=require('lucide-react');
const root=__dirname;
const directions=[
['attention-rail','A1','Attention rail','Attention','A persistent summary keeps the terminal grid visible and gives attention a predictable home.','Counts omit the question itself; opening a pane still costs a context switch.','5481e3d1-5657-48b5-a4f4-504991410d2d'],
['attention-palette','A2','Attention palette','Attention','Search and keyboard selection make occasional triage fast without occupying the workspace.','Hidden until invoked; new users may miss agents waiting for input.','d4484170-225b-4b08-8b73-0802a410d061'],
['attention-stack','A3','Triage stack','Attention','Persistent task previews let you choose the next interruption before entering its terminal.','The extra column reduces terminal width, especially with twelve panes.','e9dad782-7c28-427e-820b-836b06cc689f'],
['header-compact','H1','Compact identity','Pane identity','A 32px header prioritizes stable pane number and agent, with task and branch on one line.','Long task and branch names compete for the same horizontal space.','402e1f7e-8f7b-48b4-9b58-dca376671fa2'],
['header-task','H2','Task first','Pane identity','A deliberate 48px two-line header makes the task and branch readable at a glance.','Costs 16px per pane row and needs a fallback for very narrow panes.','8ed25177-4a0a-434b-8759-464bde02cc59'],
['header-zones','H3','Fixed identity dock','Pane identity','A fixed number-and-logo zone keeps identity in place while task context truncates.','The logo needs a name tooltip, and the fixed zone takes space in narrow panes.','3bec578c-0b89-4781-9365-09b567ff92a4'],
['sidebar-tree','S1','Workspace tree','Sidebar','Repository and worktree ownership stay explicit as agents change state.','Deep nesting truncates names; collapsed branches can hide waiting panes.','fc39ea13-3373-416f-a72e-3ad5307fccd1'],
['sidebar-state','S2','Triage groups','Sidebar','Grouping by needs-you, unread and working turns navigation into a work queue.','Rows move when state changes, weakening spatial memory.','b97c6970-d48d-4b24-bcc1-dab9ac204beb'],
['sidebar-agent','S3','Agent roster','Sidebar','Agent groups suit workflows where each assistant has a known role.','Repository ownership is weaker and urgent work can be buried in another agent group.','ec82ccfb-5c48-472c-b837-48f224c18f12']
].map(([slug,code,title,group,why,risk,draftId])=>({slug,code,title,group,why,risk,draftId}));
fs.writeFileSync(path.join(root,'directions.json'),JSON.stringify(directions,null,2));
fs.mkdirSync(path.join(root,'superdesign-originals'),{recursive:true});
const src=fs.readFileSync('src/components/AILogos.tsx','utf8');
for(const name of ['Claude','Codex','Gemini']){
 let block=src.split('export function '+name+'Logo')[1].split('export function')[0];
 let svg=block.match(/<svg[\s\S]*?<\/svg>/)[0].replaceAll('{size}','"20"').replaceAll('{color}','"#22C55E"');
 for(const [a,b] of [['fillRule','fill-rule'],['clipRule','clip-rule'],['stopColor','stop-color'],['stopOpacity','stop-opacity']])svg=svg.replaceAll(a,b);
 fs.writeFileSync(path.join(root,'assets',name.toLowerCase()+'.svg'),svg);
}
const ph={'bird-bold':'Bird','browser':'PanelsTopLeft','check-square':'SquareCheck','cpu-fill':'Cpu','cube':'Box','dots-three-vertical-bold':'EllipsisVertical','folder-simple':'Folder','gear':'Settings','git-branch':'GitBranch','house-simple':'House','magnifying-glass':'Search','seal-warning':'BadgeAlert','terminal-window':'Terminal','warning-circle':'CircleAlert','warning-circle-fill':'CircleAlert'};
function agentFor(s){if(/claude|anthropic/.test(s))return 'claude';if(/gemini|google/.test(s))return 'gemini';if(/openai|codex|binary|iot-connect|lucide:bot/.test(s))return 'codex';}
for(const d of directions){
 const file=path.join(root,d.slug+'.html'), original=path.join(root,'superdesign-originals',d.slug+'.html');
 if(!fs.existsSync(original))fs.copyFileSync(file,original);
 let html=fs.readFileSync(original,'utf8').replace(/@import\s+url\([^;]+;/g,'').replace(/font-family:\s*[^;]+;/g,m=>/mono/i.test(m)?"font-family: 'Geist Mono Variable', monospace;":"font-family: 'Geist Variable', sans-serif;");
 const dom=new JSDOM(html),doc=dom.window.document;
 doc.querySelectorAll('script,link[rel="stylesheet"]').forEach(e=>e.remove());
 let tail=doc.createElement('script');tail.src='assets/tailwind-browser.js';doc.head.prepend(tail);
 doc.querySelectorAll('iconify-icon,img').forEach(el=>{
   const key=el.getAttribute('icon')||el.getAttribute('src')||'', agent=agentFor(key);
   if(agent){const im=doc.createElement('img');im.src='assets/'+agent+'.svg';im.alt=agent[0].toUpperCase()+agent.slice(1);im.className='agent-logo';el.replaceWith(im);return;}
   if(el.tagName!=='ICONIFY-ICON')return;
   const [family,slug]=key.split(':');const name=family==='ph'?ph[slug]:slug.split('-').map(s=>s[0].toUpperCase()+s.slice(1)).join('');
   const Icon=icons[name];if(!Icon)throw Error('Missing icon '+key+' '+name);
   el.outerHTML=renderToStaticMarkup(React.createElement(Icon,{size:16,'aria-hidden':true,className:el.className+' local-icon'}));
 });
 const walk=doc.createTreeWalker(doc.body,dom.window.NodeFilter.SHOW_TEXT);
 const replace={'Claude-3.5-Sonnet':'Claude','Claude 3.5 Sonnet':'Claude','Claude-3-Haiku':'Claude','Claude-3.5':'Claude','Claude 3.5':'Claude','Codex-7B':'Codex','Codex-v4':'Codex','Gemini-Pro-1.5':'Gemini','Gemini-Pro':'Gemini','Gemini Pro':'Gemini','Gemini Flash':'Gemini','GPT-4o':'Codex','Feature/Auth-Bypass':'01 · Header layout','Awaiting confirmation for `rm -rf /cache`':'Use the compact header?','Test suite failed on 4/12 cases':'Retry the four failed tests?','Fix/Memory-Leak':'02 · Pane resize','Docs/API-Reference':'03 · API reference','Chore/Global-Styles':'04 · Global styles','Build/Production':'05 · Production build','Refactoring payment middleware':'Refine pane navigation','src/lib/auth/validators.ts':'feat/pane-navigation','Confirm destructive migration':'Choose sidebar layout','feat/db-cleanup':'feat/sidebar-layout','DROP TABLE legacy_users':'the compact workspace layout','This action is irreversible.':'Choose a layout to continue.','Codex wants to execute':'Codex is proposing','Approve':'Use layout','Details':'Compare options','src/lib/auth/gate.ts':'src/components/PaneHeader.tsx','feat/auth-middleware-refactor':'Refine pane header','fix/ui-overflow-fix-v2-final':'Fix terminal overflow','Direction 1: Single-Line Header (Identity Focused)':'Compact identity · 32px · Agent / task / branch','Recent Activity':'Unread','Action Required':'Needs you'};
 let n;while(n=walk.nextNode()){for(const [a,b]of Object.entries(replace))n.textContent=n.textContent.replaceAll(a,b);if(n.textContent.trim()==='Waiting')n.textContent=n.textContent.replace('Waiting','Needs you');if(n.textContent.trim()==='idle'||n.textContent.trim()==='Idle'||n.textContent.trim()==='Zzz')n.textContent='';}
 // Preserve component geometry; deviations are intentional and documented.
 doc.body.dataset.direction=d.slug;
 if(d.slug==='header-compact'){
   doc.querySelectorAll('header [data-sd-id="14"],header [data-sd-id="45"]').forEach(e=>{e.classList.remove('flex-col');e.classList.add('items-center','gap-3');});
 }
 if(d.slug==='header-zones'){
  doc.querySelector('[data-sd-id="9"]').textContent='feat/pane-header';
  doc.querySelector('[data-sd-id="8"]').title='Refine pane header · feat/pane-header';
  doc.querySelector('[data-sd-id="27"]')?.setAttribute('title','Fix terminal overflow · fix/overflow');
 }
 if(d.slug==='sidebar-agent'){
   const count=doc.querySelector('[data-sd-id="12"]');if(count)count.textContent='2';
   // Remove a malformed generator comment rendered as visible text.
   const walker=doc.createTreeWalker(doc.body,dom.window.NodeFilter.SHOW_TEXT);let t;
   while(t=walker.nextNode())if(t.textContent.includes('-->'))t.textContent='';
 }
 if(d.slug==='attention-rail'){
  doc.querySelector('[data-sd-id="11"]').textContent='1';doc.querySelector('[data-sd-id="15"]').textContent='1';
  doc.querySelector('[data-sd-id="30"]').textContent='01 · Claude';doc.querySelector('[data-sd-id="41"]').textContent='02 · Gemini';doc.querySelector('[data-sd-id="51"]').textContent='03 · Codex';
 }
 doc.querySelectorAll('.truncate,.truncate-sidebar').forEach(e=>{if(e.textContent.trim())e.title=e.textContent.trim();});
 doc.querySelectorAll('button').forEach(e=>{e.disabled=true;e.title='Visual study — terminal actions are not connected';if(!e.textContent.trim())e.setAttribute('aria-label','Terminal action (visual study)');});
 doc.querySelectorAll('input').forEach(e=>e.setAttribute('aria-label',e.placeholder||'Search'));
 // Keep the product accent achromatic; brand colors live only in the real SVG assets.
 doc.querySelectorAll('[class]').forEach(el=>{el.className.baseVal===undefined && el.setAttribute('class',el.getAttribute('class').replace(/text-(?:blue|purple|violet|cyan|indigo|slate)-\d+(?:\/\d+)?/g,'text-[var(--muted-foreground)]').replace(/bg-(?:blue|purple|violet|cyan|indigo|slate)-\d+(?:\/\d+)?/g,'bg-[var(--popover)]').replace(/border-(?:blue|purple|violet|cyan|indigo|slate)-\d+(?:\/\d+)?/g,'border-[var(--border)]'));});
 doc.querySelectorAll('span').forEach(el=>{
   if(/^(working|working\.\.\.|busy)$/i.test(el.textContent.trim())){
     el.style.color='var(--muted-foreground)';
     const p=el.parentElement;if(p.children.length<=3){p.style.background='transparent';p.style.borderColor='var(--border)';p.querySelectorAll('svg').forEach(x=>x.style.color='var(--muted-foreground)');p.querySelectorAll('.state-dot').forEach(x=>x.style.background='var(--muted-foreground)');}
   }
 });
 if(d.slug==='attention-rail')doc.querySelector('[data-sd-id="19"]').querySelectorAll('div').forEach(x=>x.style.background='var(--muted-foreground)');
 if(d.slug==='sidebar-tree'){
  const at=[...doc.querySelectorAll('span')].find(x=>x.textContent.trim()==='02');if(at)at.textContent='01';
  doc.querySelectorAll('.status-dot').forEach(x=>x.style.background='var(--muted-foreground)');
 }
 doc.querySelectorAll('input').forEach(e=>{e.readOnly=true;e.title='Visual study — search is not connected';});
 doc.title='Nest · '+d.code+' '+d.title;
 const shared=doc.createElement('link');shared.rel='stylesheet';shared.href='assets/review.css';doc.head.append(shared);
 const bar=doc.createElement('nav');bar.className='review-bar';bar.setAttribute('aria-label','Design review');bar.innerHTML=`<a href="index.html">← All directions</a><strong>${d.code} / ${d.title}</strong><span>Visual study · Sample data</span><a href="${directions[(directions.indexOf(d)+1)%9].slug}.html">Next →</a>`;
 doc.body.prepend(bar);
 const notes=doc.createElement('details');notes.className='review-notes';notes.innerHTML=`<summary>Why this direction / risk</summary><p>${d.why}</p><p><strong>Risk:</strong> ${d.risk}</p>`;doc.body.append(notes);
 fs.writeFileSync(file,dom.serialize());
}
