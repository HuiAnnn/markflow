'use strict';
const $ = selector => document.querySelector(selector);
const api = window.markflow;
let vditor=null, model=null, mode='ir', ready=false, busy=false, initialValue='', dirty=false;
let autosaveTimer,searchTimer,searchGeneration=0,noticeTimer,autosavePaused=false;
const expanded=new Set();
const history=new DocumentHistory();
const themeNames={system:'跟随系统',light:'浅色',dark:'深色',sepia:'暖纸'};
const legacyThemes={paper:'light',night:'dark',newsprint:'sepia',github:'light'};
let systemDark=matchMedia('(prefers-color-scheme: dark)').matches;
const storedTheme=localStorage.getItem('markflow.theme') || 'system';
const prefs={theme:legacyThemes[storedTheme] || (themeNames[storedTheme]?storedTheme:'system'),autosave:localStorage.getItem('markflow.autosave')==='true',sidebar:localStorage.getItem('markflow.sidebar')!=='false',outline:localStorage.getItem('markflow.outline')===null?innerWidth>=1180:localStorage.getItem('markflow.outline')==='true',typewriter:localStorage.getItem('markflow.typewriter')==='true'};
let focusMode=false,lastSettingsFocus=null,compactInspector=false;
function icon(name){const el=document.createElement('span');el.className='icon icon-'+name;el.setAttribute('aria-hidden','true');return el;}
function syncUI(){return request('ui-state',{...prefs,mode,focus:focusMode,sidebar:prefs.sidebar&&!focusMode,outline:!$('#outline').hidden&&!focusMode}).catch(error=>notice(error.message,true));}
function applyLayout(){
  document.body.classList.toggle('focus-mode',focusMode);document.body.classList.toggle('typewriter',prefs.typewriter);
  $('#sidebar').hidden=!prefs.sidebar;$('#sidebar-divider').hidden=!prefs.sidebar;$('#outline').hidden=!(prefs.outline && (innerWidth>=1180 || compactInspector));
  $('#btn-sidebar').setAttribute('aria-expanded',String(prefs.sidebar&&!focusMode));$('#btn-outline').setAttribute('aria-expanded',String(!$('#outline').hidden&&!focusMode));
  $('#exit-focus').hidden=!focusMode;$('#setting-typewriter').checked=prefs.typewriter;
  for(const key of ['sidebar','outline','typewriter'])localStorage.setItem('markflow.'+key,String(prefs[key]));
  syncUI();
}
function updateCompact(){const compact=innerWidth<1180;if(document.body.dataset.compact!==String(compact))compactInspector=false;document.body.dataset.compact=String(compact);applyLayout();}
function openSettings(){lastSettingsFocus=document.activeElement;$('#settings-dialog').showModal();}
async function request(action,payload) {
  const result=await api.request(action,payload);
  if(!result.ok){if(result.saveCanceled)autosavePaused=true;throw new Error(result.error);}
  if(result.value?.saveCanceled)autosavePaused=true;
  return result.value;
}
function notice(message,error=false) {
  clearTimeout(noticeTimer);$('#notice-message').textContent=message;$('#notice').hidden=false;$('#notice').classList.toggle('error',error);$('#notice-icon').className='icon icon-'+(error?'circle-alert':'circle-check');
  if(!error)noticeTimer=setTimeout(()=>$('#notice').hidden=true,5000);
}
function content() {const value=vditor?.getValue() || '';return !dirty && value===initialValue?model.document.content:value;}
function updateDirty() {
  $('#st-dirty').hidden=!dirty;$('#title-dirty').hidden=!dirty;
  $('#st-save').textContent=dirty?(prefs.autosave && !autosavePaused && model?.document.path?'等待自动保存':'已编辑'):model?.document.path?'已保存到本地':'未存储文稿';
  $('#save-status-icon').className='icon icon-'+(dirty?'circle':'check');
}
function applyTheme(notify=true) {
  const effective=prefs.theme==='system'?(systemDark?'dark':'light'):prefs.theme;
  document.body.dataset.theme=effective;$('#theme-select').value=prefs.theme;$('#appearance-name').textContent=themeNames[prefs.theme];
  $('#btn-appearance').setAttribute('aria-label','选择外观：'+themeNames[prefs.theme]);
  const dark=effective==='dark';
  vditor?.setTheme(dark?'dark':'classic',dark?'dark':'light',dark?'github-dark':'github','app://markflow/vendor/vditor/dist/css/content-theme');
  localStorage.setItem('markflow.theme',prefs.theme);if(notify)syncUI();
}
function updateStats(md) {
  const count=md.replace(/\s/g,'').length;
  $('#st-words').textContent=`${count.toLocaleString()} 字`;
  $('#st-lines').textContent=`${md?md.split('\n').length:0} 行`;
  $('#st-reading').textContent=`约 ${Math.max(1,Math.ceil(count/400))} 分钟阅读`;
}
function headings(md) {
  const result=[];let fence=null;const lines=md.split('\n');
  lines.forEach((line,index)=>{
    const marker=/^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if(marker){if(!fence)fence=marker[1];else if(marker[1][0]===fence[0] && marker[1].length>=fence.length)fence=null;return;}
    if(fence)return;
    const match=/^\s{0,3}(#{1,6})\s+(.+?)(?:\s+#+)?$/.exec(line);
    if(match)result.push({level:match[1].length,text:match[2].replace(/[*_`]/g,''),line:index+1});
    else if(index>0 && /^(=+|-+)\s*$/.test(line) && lines[index-1].trim())result.push({level:line[0]==='='?1:2,text:lines[index-1],line:index});
  });return result;
}
function updateOutline(md) {
  const list=$('#outline-list');list.replaceChildren();const items=headings(md);$('#outline-empty').hidden=items.length>0;
  items.forEach((heading,index)=>{
    const li=document.createElement('li');li.className=`h${heading.level}`+(index===0?' active':'');
    const button=document.createElement('button');button.textContent=heading.text;button.title=heading.text;
    button.onclick=()=>{
      if(mode==='sv')jumpToLine(heading.line);
      else {const target=$('#editor .vditor-ir').querySelectorAll('h1,h2,h3,h4,h5,h6')[index];target?.scrollIntoView({behavior:'smooth',block:'start'});}
      list.querySelectorAll('li').forEach(el=>el.classList.toggle('active',el===li));
    };li.append(button);list.append(li);
  });
}
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  if(prefs.autosave && !autosavePaused && dirty && model?.document.path)autosaveTimer=setTimeout(()=>run('autosave-write'),1200);
}
function editorChanged(value) {
  if(!ready)return;
  history.record(value);autosavePaused=false;dirty=value!==initialValue;updateDirty();updateStats(value);updateOutline(value);
  request('sync',{content:content()}).catch(error=>notice(error.message,true));
  scheduleAutosave();
  if(document.body.classList.contains('typewriter')) {
    const node=window.getSelection()?.anchorNode;const el=node?.nodeType===1?node:node?.parentElement;
    el?.closest('[data-block]')?.scrollIntoView({block:'center',behavior:'smooth'});
  }
}
async function initEditor(md) {
  ready=false;document.body.dataset.ready='false';
  if(vditor)vditor.destroy();$('#editor').replaceChildren();
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('编辑器初始化超时，请重新打开应用。')),20000);
    vditor=new Vditor('editor',{
      mode,value:md,lang:'zh_CN',cdn:'app://markflow/vendor/vditor',height:'100%',toolbar:['edit-mode'],
      cache:{enable:false},counter:{enable:false},outline:{enable:false},
      preview:{mode:'editor',math:{engine:'KaTeX'},markdown:{sanitize:true},theme:{current:document.body.dataset.theme==='dark'?'dark':'light',path:'app://markflow/vendor/vditor/dist/css/content-theme'},hljs:{style:'github'}},
      input:editorChanged,
      after:()=>{clearTimeout(timeout);initialValue=vditor.getValue();ready=true;document.body.dataset.ready='true';applyTheme();updateOutline(initialValue);updateStats(initialValue);if(busy)vditor.disabled();resolve();}
    });
  });
  updateModeUI();
}
function updateModeUI() {
  $('#st-mode').textContent=mode==='ir'?'即时渲染':'源码模式';
  $('#btn-edit').setAttribute('aria-pressed',String(mode==='sv'));
  $('#btn-preview').setAttribute('aria-pressed',String(mode==='ir'));
  const editable=$('#editor .vditor-'+mode);editable.setAttribute('aria-label',mode==='ir'?'Markdown 即时渲染编辑器':'Markdown 源码编辑器');editable.setAttribute('role','textbox');editable.setAttribute('aria-multiline','true');
  syncUI();
}
async function setMode(next) {
  if(mode===next)return;
  // Use Vditor's own mode control so its per-mode undo stacks survive.
  // The toolbar is hidden; our accessible segmented control is the visible UI.
  vditor.enable();
  const button=$('#editor button[data-mode="'+next+'"]');
  if(!button)throw new Error('无法切换编辑模式。');
  button.click();mode=vditor.getCurrentMode();if(!dirty)initialValue=vditor.getValue();updateModeUI();updateDirty();
}
async function adopt(next,reload=true) {
  if(next?.canceled)return false;
  model=next;systemDark=model.systemDark;$('#app-version').textContent=model.version;
  document.querySelector('base').href=model.mediaBase;
  $('#filename').textContent=model.document.name;
  $('#filename').title=model.document.path || '尚未保存到磁盘';
  $('#filepath').textContent=model.document.path?model.document.path.split('/').slice(-2,-1)[0]:'Markdown 文稿';
  $('#filepath').title=model.document.path || '';
  if(reload){autosavePaused=false;dirty=!!model.document.dirty;await initEditor(model.document.content);history.reset(vditor.getValue());$('#st-position').textContent='';}
  updateDirty();renderFiles();return true;
}
function renderFiles() {
  const list=$('#file-list');list.replaceChildren();
  $('#folder-name').textContent=model.tree?.name || '最近打开';
  $('#folder-name').title=model.folder || '';
  $('#workspace-note').hidden=!!model.folder || model.recent.length>0;
  function fileButton(file) {
    const button=document.createElement('button');button.className='file-item'+(file.path===model.document.path?' active':'');button.title=file.path;
    const fileIcon=icon('file-text');button.setAttribute('aria-current',file.path===model.document.path?'page':'false');
    const label=document.createElement('span');label.className='name';label.textContent=file.name;
    button.append(fileIcon,label);button.onclick=()=>run('open-path',{path:file.path});return button;
  }
  function appendNodes(nodes,parent) {
    for(const node of nodes) {
      if(node.type==='file')parent.append(fileButton(node));
      else {
        const details=document.createElement('details');details.className='tree-folder';details.open=expanded.has(node.path);
        const summary=document.createElement('summary');const disclosure=icon('chevron-right');disclosure.classList.add('disclosure');const label=document.createElement('span');label.className='folder-label';label.textContent=node.name;summary.append(disclosure,icon('folder'),label);details.append(summary);
        const children=document.createElement('div');children.className='tree-children';appendNodes(node.children,children);details.append(children);
        details.ontoggle=()=>details.open?expanded.add(node.path):expanded.delete(node.path);parent.append(details);
      }
    }
  }
  if(model.tree) {
    appendNodes(model.tree.nodes,list);
    if(!model.tree.nodes.length){const empty=document.createElement('p');empty.className='empty-state';empty.textContent='此文件夹中还没有 Markdown 文档。';list.append(empty);}
    if(model.tree.truncated || model.tree.skipped.length)notice('文件树已加载；部分隐藏、超深或不可读目录未列出。');
  } else model.recent.forEach(file=>list.append(fileButton({path:file,name:file.split('/').pop()})));
}
function showTab(tab) {
  $('#files-panel').hidden=tab!=='files';$('#search-panel').hidden=tab!=='search';
  document.querySelectorAll('[data-tab]').forEach(el=>{el.setAttribute('aria-selected',String(el.dataset.tab===tab));el.tabIndex=el.dataset.tab===tab?0:-1;});
  if(tab==='search'){prefs.sidebar=true;focusMode=false;applyLayout();$('#search-input').focus();doSearch();}
}
async function doSearch() {
  const generation=++searchGeneration;const query=$('#search-input').value;
  $('#search-results').replaceChildren();$('#search-open-folder').hidden=!!model?.folder;
  if(!model?.folder){$('#search-status').textContent='先打开一个文件夹';return;}
  if(!query.trim()){$('#search-status').textContent='搜索 Markdown 和文本文件内容';return;}
  $('#search-status').textContent='正在搜索…';
  try {
    const result=await request('search',{query});if(generation!==searchGeneration)return;
    $('#search-status').textContent=`${result.results.length} 处匹配${result.truncated?' · 已达到搜索上限':''}${result.skipped?.length?' · 部分文件不可读':''}`;
    for(const match of result.results) {
      const button=document.createElement('button');button.className='search-result';
      const name=document.createElement('strong');name.textContent=`${match.relativePath}:${match.line}`;
      const excerpt=document.createElement('p');const at=match.text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());if(at>=0){const mark=document.createElement('mark');mark.textContent=match.text.slice(at,at+query.length);excerpt.append(match.text.slice(0,at),mark,match.text.slice(at+query.length));}else excerpt.textContent=match.text;
      button.append(name,excerpt);button.onclick=()=>run('search-result',match);$('#search-results').append(button);
    }
  } catch(error){if(generation===searchGeneration)$('#search-status').textContent=error.message;}
}
async function jumpToLine(line) {
  await setMode('sv');
  const root=$('#editor .vditor-sv');root.focus();
  const lines=root.textContent.split('\n');const start=lines.slice(0,line-1).reduce((sum,text)=>sum+text.length+1,0);
  const end=start+(lines[line-1]?.length || 0);const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  let node,offset=0,startNode,endNode,startOffset=0,endOffset=0;
  while((node=walker.nextNode())) {
    const length=node.textContent.length;
    if(!startNode && start<=offset+length){startNode=node;startOffset=Math.max(0,start-offset);}
    if(end<=offset+length){endNode=node;endOffset=Math.max(0,end-offset);break;}
    offset+=length;
  }
  if(startNode){const range=document.createRange();range.setStart(startNode,startOffset);range.setEnd(endNode || startNode,endNode?endOffset:startOffset);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);startNode.parentElement.scrollIntoView({block:'center'});}
  $('#st-position').textContent=`第 ${line} 行`;
}
async function renderedExport() {
  await setMode('ir');
  // Allow Vditor's deferred block renderers to finish before printing.
  const started=Date.now();
  while(Date.now()-started<5000) {
    const previews=[...document.querySelectorAll('.vditor-ir__preview')];
    if(previews.every(el=>!el.querySelector('.language-mermaid:not([data-processed])')) && !document.querySelector('.language-math:empty'))break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  vditor.blur();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
}
async function htmlExport() {
  const container=document.createElement('div');container.innerHTML=vditor.getHTML();
  for(const img of container.querySelectorAll('img')) {
    const source=img.getAttribute('src');if(!source || /^(https?:|data:)/i.test(source))continue;
    const url=new URL(source,document.baseURI);
    if(url.protocol!=='app:' || url.host!=='document')continue;
    const response=await fetch(url.href);if(!response.ok)throw new Error(`导出图片失败：${source}。请确认图片位于已打开的文件夹中。`);
    const blob=await response.blob();
    img.src=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('图片读取失败'));reader.readAsDataURL(blob);});
  }
  const escape=text=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https: http:;"><title>${escape(model.document.name)}</title><style>body{max-width:780px;margin:48px auto;padding:0 28px;font:16px/1.8 -apple-system,BlinkMacSystemFont,sans-serif;color:#303932}h1,h2,h3{line-height:1.4}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:8px 14px}blockquote{border-left:3px solid #9bac8b;padding-left:20px;color:#777}pre{padding:18px;background:#f4f4f0;overflow:auto}code{font-family:monospace}img,svg{max-width:100%}a{color:#55765c}</style></head><body>${container.innerHTML}</body></html>`;
}
let actionQueue=Promise.resolve();
function run(command,payload) {
  const next=actionQueue.then(()=>perform(command,payload));
  actionQueue=next.catch(error=>notice(error.message,true));
  return next;
}
async function perform(command,payload) {
  const action=typeof command==='string'?command:command.action;
  if(typeof command==='object')payload=command;
  if(!ready || busy)return;
  if(action==='autosave-write' && (!dirty || !model.document.path))return;
  if(action==='undo' || action==='redo') {
    if(document.activeElement?.closest('input,textarea'))document.execCommand(action);
    else {const value=history.move(action==='undo'?-1:1);if(value!==null){const baseline=initialValue;await initEditor(value);initialValue=baseline;history.values[history.index]=vditor.getValue();vditor.focus();editorChanged(vditor.getValue());}}
    return;
  }
  history.boundary();
  const active=document.activeElement;
  const editorFocused=!!active?.closest('#editor');
  const selection=getSelection();const caret=editorFocused && selection.rangeCount?selection.getRangeAt(0).cloneRange():null;
  const locksEditor=['new','open','open-path','save','save-as','autosave-write','folder','refresh','search-result','export-html','export-docx','export-pdf','pdf-native','close'].includes(action);
  busy=true;clearTimeout(autosaveTimer);
  if(locksEditor){document.body.classList.add('busy');vditor.disabled();}
  try {
    await request('sync',{content:content()});
    switch(action) {
      case 'source':await setMode(mode==='ir'?'sv':'ir');break;
      case 'mode-source':await setMode('sv');break;
      case 'mode-preview':await setMode('ir');break;
      case 'theme':prefs.theme=document.body.dataset.theme==='dark'?'light':'dark';applyTheme();break;
      case 'set-theme':if(themeNames[payload?.theme]){prefs.theme=payload.theme;applyTheme();}break;
      case 'sidebar':if(focusMode){focusMode=false;prefs.sidebar=true;}else prefs.sidebar=!prefs.sidebar;applyLayout();break;
      case 'outline':if(focusMode){focusMode=false;prefs.outline=true;compactInspector=true;}else if(innerWidth<1180){compactInspector=$('#outline').hidden;prefs.outline=true;}else prefs.outline=!prefs.outline;applyLayout();break;
      case 'focus':focusMode=!focusMode;applyLayout();break;
      case 'typewriter':prefs.typewriter=!prefs.typewriter;applyLayout();break;
      case 'settings':openSettings();break;
      case 'appearance-menu':case 'export-menu':case 'writing-menu': {
        const kind=action.split('-')[0];const id={appearance:'btn-appearance',export:'btn-export',writing:'btn-more'}[kind];const button=$('#'+id);const bounds=button.getBoundingClientRect();button.setAttribute('aria-expanded','true');
        await request('popup',{kind,anchor:{x:bounds.left,y:bounds.bottom+4}});break;
      }
      case 'autosave':$('#autosave').checked=!$('#autosave').checked;setAutosave();break;
      case 'search':showTab('search');break;
      case 'new':case 'open':case 'open-path':await adopt(await request(action,payload));break;
      case 'save':case 'save-as':case 'autosave-write': {
        const next=await request(action==='autosave-write'?'save':action);
        if(!next.canceled){autosavePaused=false;dirty=false;initialValue=vditor.getValue();await adopt(next,false);if(action!=='autosave-write')notice('已保存到本地');}else {autosavePaused=true;updateDirty();}break;
      }
      case 'folder':case 'refresh':await adopt(await request(action),false);if(!$('#search-panel').hidden)doSearch();break;
      case 'search-result': {
        const next=await request('open-path',{path:payload.path});if(await adopt(next))await jumpToLine(payload.line);break;
      }
      case 'export-html':case 'export-docx':case 'export-pdf':case 'pdf-native': {
        const previousMode=mode;
        try {
          if(action==='export-pdf' || action==='pdf-native')await renderedExport();
          const result=await request(action==='pdf-native'?'pdf-native':'export',{format:action.replace('export-',''),html:action==='export-html'?await htmlExport():undefined});
          if(result.path)notice(`已导出 ${result.path.split('/').pop()}`);
        } finally {await setMode(previousMode);}
        break;
      }
      case 'close':await request('close');break;
    }
  } catch(error){if(['save','save-as','autosave-write'].includes(action))autosavePaused=true;notice(error.message,true);}
  finally {
    busy=false;vditor?.enable();document.body.classList.remove('busy');
    const enteringEditor=['source','mode-source','mode-preview'].includes(action);
    if(!$('#settings-dialog').open && (enteringEditor || (editorFocused && locksEditor && action!=='search-result'))) {
      vditor.focus();
      if(caret?.startContainer.isConnected && caret?.endContainer.isConnected && !enteringEditor){selection.removeAllRanges();selection.addRange(caret);}
    }
    updateDirty();scheduleAutosave();
  }
}
function setAutosave() {
  autosavePaused=false;prefs.autosave=$('#autosave').checked;localStorage.setItem('markflow.autosave',String(prefs.autosave));syncUI();updateDirty();
  scheduleAutosave();
}
for(const [id,command] of Object.entries({'btn-open':'open','empty-open-file':'open','btn-save':'save','btn-new':'new','btn-folder':'folder','empty-open-folder':'folder','search-open-folder':'folder','btn-refresh':'refresh','btn-edit':'mode-source','btn-preview':'mode-preview','btn-outline':'outline','btn-close-outline':'outline','btn-sidebar':'sidebar','exit-focus':'focus','btn-settings':'settings','btn-appearance':'appearance-menu','btn-export':'export-menu','btn-more':'writing-menu'}))$('#'+id).onclick=()=>run(command);
document.querySelectorAll('[data-tab]').forEach(button=>{
  button.onclick=()=>showTab(button.dataset.tab);
  button.onkeydown=event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?'files':event.key==='End'?'search':button.dataset.tab==='files'?'search':'files';showTab(next);$('[data-tab="'+next+'"]').focus();}};
});
$('#theme-select').onchange=event=>run({action:'set-theme',theme:event.target.value});
$('#search-input').oninput=()=>{clearTimeout(searchTimer);searchGeneration++;searchTimer=setTimeout(doSearch,220);};
$('#autosave').checked=prefs.autosave;$('#autosave').onchange=setAutosave;
$('#setting-typewriter').onchange=()=>run('typewriter');
$('#settings-dialog').addEventListener('close',()=>lastSettingsFocus?.focus());
$('#notice-close').onclick=()=>$('#notice').hidden=true;
document.addEventListener('keydown',event=>{
  if((event.metaKey || event.ctrlKey) && event.key.toLowerCase()==='z' && event.target.closest('#editor')){event.preventDefault();event.stopImmediatePropagation();run(event.shiftKey?'redo':'undo');}
},true);
document.addEventListener('keydown',event=>{
  if(event.key==='Escape' && !$('#settings-dialog').open){if(focusMode){event.preventDefault();run('focus');}else if(compactInspector){compactInspector=false;applyLayout();}else if(!$('#notice').hidden){$('#notice').hidden=true;}}
});
document.addEventListener('click',event=>{if(compactInspector && event.target.closest('#editor-host')){compactInspector=false;applyLayout();}const link=event.target.closest('#editor a');if(link && (event.metaKey || event.ctrlKey)){event.preventDefault();if(/^https?:|^mailto:/.test(link.href))request('external',{url:link.href}).catch(error=>notice(error.message,true));}});
const divider=$('#sidebar-divider');
function setSidebarWidth(width){const clamped=Math.max(200,Math.min(340,width));document.documentElement.style.setProperty('--sidebar-width',clamped+'px');divider.setAttribute('aria-valuenow',String(Math.round(clamped)));localStorage.setItem('markflow.sidebar-width',String(clamped));}
setSidebarWidth(Number(localStorage.getItem('markflow.sidebar-width')) || 248);
divider.onpointerdown=event=>{divider.setPointerCapture(event.pointerId);};
divider.onpointermove=event=>{if(divider.hasPointerCapture(event.pointerId))setSidebarWidth(event.clientX);};
divider.onpointerup=event=>{if(divider.hasPointerCapture(event.pointerId))divider.releasePointerCapture(event.pointerId);};
divider.onkeydown=event=>{if(event.key==='ArrowLeft' || event.key==='ArrowRight'){event.preventDefault();setSidebarWidth(Number(divider.getAttribute('aria-valuenow'))+(event.key==='ArrowRight'?16:-16));}};
window.addEventListener('resize',updateCompact);updateCompact();
api.onAppearance(state=>{systemDark=state.dark;applyTheme(false);});
api.onCommand(command=>{
  if(command?.action==='menu-dismissed'){const id={appearance:'btn-appearance',export:'btn-export',writing:'btn-more'}[command.kind];if(id)$('#'+id).setAttribute('aria-expanded','false');return;}
  run(command);
});
applyTheme(false);applyLayout();
request('ready').then(state=>adopt(state)).then(()=>request('initialized')).catch(error=>notice(error.message,true));
