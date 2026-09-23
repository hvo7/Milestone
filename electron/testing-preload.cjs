const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('milestoneTesting', { seed: ipcRenderer.sendSync('testing:seed') });
