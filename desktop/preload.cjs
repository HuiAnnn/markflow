const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('markflow', {
  request: (action, payload) => ipcRenderer.invoke('markflow:request', action, payload),
  onAppearance: callback => {
    const listener=(_event,state)=>callback(state);ipcRenderer.on('appearance-changed',listener);
    return ()=>ipcRenderer.removeListener('appearance-changed',listener);
  },
  onCommand: callback => {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on('menu-command', listener);
    return () => ipcRenderer.removeListener('menu-command', listener);
  }
});
