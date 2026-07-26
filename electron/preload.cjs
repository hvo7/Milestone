const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  notion: {
    loadConfig:      ()             => ipcRenderer.invoke('notion:load-config'),
    saveConfig:      (config)       => ipcRenderer.invoke('notion:save-config', config),
    testConnection:  (apiKey)       => ipcRenderer.invoke('notion:test-connection', apiKey),
    sync:            (data)         => ipcRenderer.invoke('notion:sync', data),
    pull:            ()             => ipcRenderer.invoke('notion:pull'),
  },
});
