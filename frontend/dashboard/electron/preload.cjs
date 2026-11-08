const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('underdogDesktop', {
  dashboardReady: () => ipcRenderer.send('underdog:dashboard-ready'),
  splashAnimationFinished: () => ipcRenderer.send('underdog:splash-animation-finished'),
});
