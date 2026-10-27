const {Menu} = require('electron');
const themes=[['system','跟随系统'],['light','浅色'],['dark','深色'],['sepia','暖纸']];
function appearanceItems(command,state){return themes.map(([theme,label])=>({id:`theme-${theme}`,label,type:'radio',checked:state.theme===theme,click:()=>command({action:'set-theme',theme})}));}
function exportItems(command){return [
  {label:'PDF…',click:()=>command('pdf-native')},
  {label:'HTML 网页…',click:()=>command('export-html')},
  {label:'Word 文稿…',sublabel:'需要 Pandoc',click:()=>command('export-docx')},
  {type:'separator'},
  {label:'使用 Pandoc 导出 PDF…',click:()=>command('export-pdf')}
];}
function writingItems(command,state){return [
  {label:'专注模式',type:'checkbox',checked:!!state.focus,click:()=>command('focus')},
  {label:'打字机模式',type:'checkbox',checked:!!state.typewriter,click:()=>command('typewriter')},
  {type:'separator'},
  {label:'自动保存',type:'checkbox',checked:!!state.autosave,click:()=>command('autosave')},
  {type:'separator'},
  {label:'设置…',accelerator:'CmdOrCtrl+,',click:()=>command('settings')}
];}
function popup(kind,window,command,state,anchor){
  const builders={appearance:appearanceItems,export:exportItems,writing:writingItems};
  if(!builders[kind])throw new Error('未知菜单。');
  const menu=Menu.buildFromTemplate(builders[kind](command,state));
  const [width,height]=window.getContentSize();
  const zoom=window.webContents.getZoomFactor();
  const x=Math.max(0,Math.min(width-1,Math.round(Number(anchor?.x || 0)*zoom)));
  const y=Math.max(0,Math.min(height-1,Math.round(Number(anchor?.y || 0)*zoom)));
  menu.popup({window,x,y,callback:()=>command({action:'menu-dismissed',kind})});
}
function applicationMenu(command,state,quit){
  const item=(label,action,accelerator)=>({label,accelerator,click:()=>command(action)});
  return Menu.buildFromTemplate([
    {label:'Markflow',submenu:[{role:'about',label:'关于 Markflow'},item('设置…','settings','CmdOrCtrl+,'),{type:'separator'},{role:'services',label:'服务'},{type:'separator'},{role:'hide',label:'隐藏 Markflow'},{role:'hideOthers',label:'隐藏其他'},{role:'unhide',label:'全部显示'},{type:'separator'},{label:'退出 Markflow',accelerator:'CmdOrCtrl+Q',click:quit}]},
    {label:'文件',submenu:[item('新建','new','CmdOrCtrl+N'),item('打开…','open','CmdOrCtrl+O'),item('打开文件夹…','folder','CmdOrCtrl+Shift+O'),{type:'separator'},item('保存','save','CmdOrCtrl+S'),item('另存为…','save-as','CmdOrCtrl+Shift+S'),{label:'导出',submenu:exportItems(command)},{type:'separator'},item('关闭窗口','close','CmdOrCtrl+W')]},
    {label:'编辑',submenu:[item('撤销','undo','CmdOrCtrl+Z'),item('重做','redo','CmdOrCtrl+Shift+Z'),{type:'separator'},{role:'cut',label:'剪切'},{role:'copy',label:'拷贝'},{role:'paste',label:'粘贴'},{role:'selectAll',label:'全选'},{type:'separator'},item('在文件夹中搜索','search','CmdOrCtrl+Shift+F')]},
    {label:'视图',submenu:[{...item('切换源码模式','source','CmdOrCtrl+E'),type:'checkbox',checked:state.mode==='sv'},{label:'外观',submenu:appearanceItems(command,state)},item('切换深浅主题','theme','CmdOrCtrl+Shift+T'),{type:'separator'},{...item('显示 / 隐藏大纲','outline','CmdOrCtrl+Shift+1'),type:'checkbox',checked:!!state.outline},{...item('显示 / 隐藏文件栏','sidebar','CmdOrCtrl+Shift+2'),type:'checkbox',checked:!!state.sidebar},{type:'separator'},...writingItems(command,state).slice(0,4),{type:'separator'},{role:'resetZoom',label:'实际大小'},{role:'zoomIn',label:'放大'},{role:'zoomOut',label:'缩小'},{role:'togglefullscreen',label:'进入全屏'}]},
    {label:'窗口',submenu:[{role:'minimize',label:'最小化'},{role:'zoom',label:'缩放'},{role:'front',label:'前置全部窗口'}]}
  ]);
}
module.exports={popup,applicationMenu};
