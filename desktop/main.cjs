const {app,BrowserWindow,Menu,dialog,ipcMain,protocol,net,shell,session,nativeTheme} = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const {pathToFileURL} = require('node:url');
const {readDocument,saveDocument,folderTree,searchFolder,resolveResource,inside,normalize} = require('./files.cjs');
const {findPandoc,exportPandoc} = require('./exports.cjs');
const {popup,applicationMenu}=require('./menus.cjs');
let uiState={theme:'system',mode:'ir',sidebar:true,outline:true,focus:false,typewriter:false,autosave:false};
const APP_ROOT = path.join(__dirname,'..');
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
app.setName('Markflow');
const customProfile = process.argv.find(x=>x.startsWith('--user-data-dir='));
if(customProfile) app.setPath('userData',customProfile.slice('--user-data-dir='.length));
let window,document,folder=null,tree=null,allowClose=false,rendererReady=false,pendingOpen=null;
let leaveSaveCanceled=false;
let recent=[]; const allowedFiles=new Set();
const filters=[{name:'Markdown 和文本',extensions:['md','markdown','mdown','txt']}];
const fresh = content => ({path:null,name:'未命名.md',content,savedContent:content,bom:false,eol:'\n',version:null});
function mediaRoot() {const base=document.path?path.dirname(document.path):null;return base && folder && inside(folder,base)?folder:base;}
function state() {const relative=document.path?path.relative(mediaRoot(),path.dirname(document.path)):'';const mediaBase='app://document/'+relative.split(path.sep).filter(Boolean).map(encodeURIComponent).join('/')+(relative?'/':'');return {document:{...document,dirty:document.content!==document.savedContent},folder,tree,recent,mediaBase,systemDark:nativeTheme.shouldUseDarkColors,version:app.getVersion()};}
function updateTitle() {
  if(!window || window.isDestroyed())return;
  const dirty=document.content!==document.savedContent;
  window.setTitle(`${document.name}${dirty?' — 已编辑':''} — Markflow`);
  window.setDocumentEdited(dirty);
  window.setRepresentedFilename(document.path || '');
}
function command(action) {if(window && !window.isDestroyed())window.webContents.send('menu-command',action);}
function remember(file) {allowedFiles.add(file);recent=[file,...recent.filter(x=>x!==file)].slice(0,12);app.addRecentDocument(file);}
async function chooseSave(as=false) {
  let destination=document.path;
  if(as || !destination) {
    const result=await dialog.showSaveDialog(window,{title:'保存 Markdown',defaultPath:destination || path.join(folder || app.getPath('documents'),document.name),filters});
    if(result.canceled)return false;
    destination=result.filePath;
  }
  let saved;
  try {saved=await saveDocument(document,document.content,destination);}
  catch(error) {
    if(error.code!=='CONFLICT')throw error;
    const {response}=await dialog.showMessageBox(window,{type:'warning',message:'磁盘上的文件已发生变化',detail:'可能有其他程序修改了这个文件。你可以保留当前编辑并另存为，或者确认覆盖。',buttons:['另存为…','覆盖磁盘文件','取消'],defaultId:0,cancelId:2});
    if(response===2)return false;
    if(response===0)return chooseSave(true);
    saved=await saveDocument(document,document.content,destination,{force:true});
  }
  document={...saved,savedContent:saved.content}; remember(saved.path);updateTitle();
  return true;
}
async function mayLeave() {
  leaveSaveCanceled=false;
  if(document.content===document.savedContent)return true;
  const {response}=await dialog.showMessageBox(window,{type:'question',message:`保存对「${document.name}」的修改？`,detail:'未保存的修改会在离开当前文档后丢失。',buttons:['保存','不保存','取消'],defaultId:0,cancelId:2});
  if(response===2)return false;
  if(response===0){try {const saved=await chooseSave();leaveSaveCanceled=!saved;return saved;}catch(error){error.saveCanceled=true;throw error;}}
  return true;
}
async function openDocument(file) {
  // Read first: an inaccessible new file must never discard the current buffer.
  await readDocument(file);
  if(!await mayLeave())return false;
  const next=await readDocument(file);
  document={...next,savedContent:next.content};remember(next.path);updateTitle();return true;
}
async function authorizePath(file) {
  if(typeof file!=='string')throw new Error('文件路径无效。');
  const real=await fs.realpath(file);
  if(allowedFiles.has(real) || allowedFiles.has(file) || (folder && inside(folder,real)))return real;
  throw new Error('请先通过打开对话框选择文件或所在文件夹。');
}
async function doExport(data) {
  const format=data?.format;
  if(!['html','pdf','docx'].includes(format))throw new Error('不支持的导出格式。');
  const pandoc=format==='html'?null:await findPandoc();
  if(format==='docx' && !pandoc) {
    await dialog.showMessageBox(window,{type:'info',message:'DOCX 导出需要 Pandoc',detail:'安装方法：brew install pandoc\n安装后重新点击导出即可。HTML 和内置 PDF 导出不需要安装。',buttons:['知道了']});
    return {canceled:true};
  }
  let nativePDF=format==='pdf' && !pandoc;
  if(nativePDF) {
    const {response}=await dialog.showMessageBox(window,{type:'info',message:'未检测到 Pandoc',detail:'可以使用内置打印引擎导出 PDF。也可安装 Pandoc 和 LaTeX 引擎使用排版导出。',buttons:['使用内置 PDF','取消'],defaultId:0,cancelId:1});
    if(response!==0)return {canceled:true};
  }
  const result=await dialog.showSaveDialog(window,{title:`导出 ${format.toUpperCase()}`,defaultPath:path.join(document.path?path.dirname(document.path):(folder || app.getPath('documents')),document.name.replace(/\.[^.]+$/,'')+`.${format}`),filters:[{name:format.toUpperCase(),extensions:[format]}]});
  if(result.canceled)return {canceled:true};
  if(format==='html') {
    if(typeof data.html!=='string' || data.html.length>40*1024*1024)throw new Error('HTML 内容无效。');
    await fs.writeFile(result.filePath,data.html,'utf8');
  } else if(nativePDF) {
    // Renderer switches to rendered mode before requesting export; print CSS removes chrome.
    const pdf=await window.webContents.printToPDF({printBackground:true,preferCSSPageSize:true});
    await fs.writeFile(result.filePath,pdf);
  } else {
    try {await exportPandoc({pandoc,format,content:document.content,destination:result.filePath,resourcePath:document.path?path.dirname(document.path):folder});}
    catch(error) {throw new Error(`Pandoc 导出失败：${error.message}\nPDF 还需要 LaTeX 引擎（如 MacTeX）；也可使用「导出 → 内置 PDF」。`);}
  }
  return {path:result.filePath};
}
async function handle(action,data) {
  switch(action) {
    case 'ready': return state();
    case 'ui-state': {
      const theme=['system','light','dark','sepia'].includes(data?.theme)?data.theme:'system';
      uiState={theme,mode:data?.mode==='sv'?'sv':'ir',sidebar:!!data?.sidebar,outline:!!data?.outline,focus:!!data?.focus,typewriter:!!data?.typewriter,autosave:!!data?.autosave};
      const source=theme==='sepia'?'light':theme;
      if(nativeTheme.themeSource!==source)nativeTheme.themeSource=source;
      installMenu();return {systemDark:nativeTheme.shouldUseDarkColors};
    }
    case 'popup': popup(data?.kind,window,command,uiState,data?.anchor);return {};

    case 'initialized': rendererReady=true; if(pendingOpen){const p=pendingOpen;pendingOpen=null;setTimeout(()=>command({action:'open-path',path:p}),100);} return state();
    case 'sync': if(typeof data?.content!=='string' || Buffer.byteLength(data.content)>10*1024*1024)throw new Error('文档不能超过 10 MB。');document.content=normalize(data.content);updateTitle();return {dirty:document.content!==document.savedContent};
    case 'new': if(!await mayLeave())return {canceled:true,saveCanceled:leaveSaveCanceled};document=fresh('');updateTitle();return state();
    case 'open': {
      const result=await dialog.showOpenDialog(window,{title:'打开 Markdown',properties:['openFile'],filters});
      if(result.canceled)return {canceled:true};
      if(!await openDocument(result.filePaths[0]))return {canceled:true,saveCanceled:leaveSaveCanceled};return state();
    }
    case 'open-path': if(!await openDocument(await authorizePath(data?.path)))return {canceled:true,saveCanceled:leaveSaveCanceled};return state();
    case 'save': case 'save-as': if(!await chooseSave(action==='save-as'))return {canceled:true};return state();
    case 'folder': {
      const result=await dialog.showOpenDialog(window,{title:'打开文件夹',properties:['openDirectory']});
      if(result.canceled)return {canceled:true};
      const nextTree=await folderTree(result.filePaths[0]);folder=nextTree.root;tree=nextTree;return state();
    }
    case 'refresh': if(folder)tree=await folderTree(folder);return state();
    case 'search': if(!folder)return {results:[],truncated:false};return searchFolder(folder,String(data?.query || '').slice(0,500));
    case 'export': return doExport(data);
    case 'pdf-native': {
      const result=await dialog.showSaveDialog(window,{title:'导出 PDF',defaultPath:document.name.replace(/\.[^.]+$/,'')+'.pdf',filters:[{name:'PDF',extensions:['pdf']}]});
      if(result.canceled)return {canceled:true};
      await fs.writeFile(result.filePath,await window.webContents.printToPDF({printBackground:true,preferCSSPageSize:true}));return {path:result.filePath};
    }
    case 'external': {
      const url=new URL(data?.url);if(!['https:','http:','mailto:'].includes(url.protocol))throw new Error('不支持这个链接。');await shell.openExternal(url.href);return {};
    }
    case 'close': if(!await mayLeave())return {canceled:true,saveCanceled:leaveSaveCanceled};allowClose=true;window.close();return {};
    default:throw new Error('未知操作。');
  }
}
function installMenu() {Menu.setApplicationMenu(applicationMenu(command,uiState,()=>window?command('close'):app.quit()));}
async function createWindow() {
  allowClose=false;rendererReady=false;
  document=fresh(await fs.readFile(path.join(APP_ROOT,'renderer/welcome.md'),'utf8'));
  window=new BrowserWindow({width:1320,height:860,minWidth:880,minHeight:580,title:'Markflow',backgroundColor:nativeTheme.shouldUseDarkColors?'#1e1e20':'#ffffff',titleBarStyle:'hiddenInset',trafficLightPosition:{x:16,y:23},webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,spellcheck:false}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event)=>event.preventDefault());
  window.on('close',event=>{if(!allowClose){event.preventDefault();command('close');}});
  window.on('closed',()=>{window=null;});
  await window.loadURL('app://markflow/renderer/index.html');
  installMenu();updateTitle();
}
app.on('open-file',(event,file)=>{event.preventDefault();allowedFiles.add(file);if(rendererReady)command({action:'open-path',path:file});else pendingOpen=file;});
app.whenReady().then(async()=>{
  app.setAboutPanelOptions({applicationName:'Markflow',applicationVersion:app.getVersion(),copyright:'Markflow Contributors',credits:'Markdown editing with Vditor. Icons by Lucide.'});
  nativeTheme.on('updated',()=>{if(window && !window.isDestroyed())window.webContents.send('appearance-changed',{dark:nativeTheme.shouldUseDarkColors});});
  session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  protocol.handle('app',async request=>{
    try {
      const url=new URL(request.url);let file;
      if(url.host==='markflow') {
        const relative=url.pathname.slice(1);
        if(!/^(renderer\/|vendor\/vditor\/dist\/)/.test(relative))return new Response('Forbidden',{status:403});
        file=await resolveResource(APP_ROOT,relative);
      } else if(url.host==='document' && document.path) {
        file=await resolveResource(mediaRoot(),url.pathname.slice(1));
        if(!/\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(file))return new Response('Unsupported image',{status:403});
      } else return new Response('Not found',{status:404});
      const response=await net.fetch(pathToFileURL(file).href);
      if(url.host==='document'){const headers=new Headers(response.headers);headers.set('Access-Control-Allow-Origin','app://markflow');return new Response(response.body,{status:response.status,headers});}
      return response;
    } catch {return new Response('Not found',{status:404});}
  });
  let operation=Promise.resolve();
  ipcMain.handle('markflow:request',(event,action,data)=>{
    if(!window || event.sender!==window.webContents || event.senderFrame?.url!=='app://markflow/renderer/index.html')return {ok:false,error:'Unauthorized request'};
    const execute=async()=>{try{return {ok:true,value:await handle(action,data)};}catch(error){return {ok:false,error:error.message,saveCanceled:!!error.saveCanceled};}};
    if(action==='search')return execute();
    const result=operation.then(execute);operation=result.catch(()=>{});return result;
  });
  const initial=process.argv.slice(app.isPackaged?1:2).find(x=>!x.startsWith('-') && /\.(md|markdown|mdown|txt)$/i.test(x));
  if(initial){pendingOpen=path.resolve(initial);allowedFiles.add(pendingOpen);}
  await createWindow();
  app.on('activate',()=>{if(!window)createWindow();});
});
app.on('window-all-closed',()=>app.quit());
