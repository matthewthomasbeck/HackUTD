const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('assessDesktop', {
  dashboardReady: () => ipcRenderer.send('assess:dashboard-ready'),
  splashAnimationFinished: () => ipcRenderer.send('assess:splash-animation-finished'),
});
