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
  sync: {
    getConfig:   ()               => ipcRenderer.invoke('sync:get-config'),
    setConfig:   (patch)          => ipcRenderer.invoke('sync:set-config', patch),
    pickFolder:  ()               => ipcRenderer.invoke('sync:pick-folder'),
    readPeers:   ()               => ipcRenderer.invoke('sync:read-peers'),
    write:       (doc)            => ipcRenderer.invoke('sync:write', doc),
    writeBackup: (name, bundle)   => ipcRenderer.invoke('sync:write-backup', { name, bundle }),
    /** Fires when a peer's file lands in the folder. Returns an unsubscribe —
     *  the raw IpcRendererEvent is deliberately not passed through, since handing
     *  the renderer an object with a `sender` would hand it back ipcRenderer. */
    onChanged: (callback) => {
      const listener = () => callback();
      ipcRenderer.on('sync:changed', listener);
      return () => ipcRenderer.removeListener('sync:changed', listener);
    },
  },
  /** Serving the app to a phone on this Wi-Fi — see electron/phone.cjs. */
  phone: {
    status:  ()     => ipcRenderer.invoke('phone:status'),
    start:   ()     => ipcRenderer.invoke('phone:start'),
    stop:    ()     => ipcRenderer.invoke('phone:stop'),
    setPort: (port) => ipcRenderer.invoke('phone:set-port', port),
  },
  /** Keeping this install current — see electron/updater.cjs. */
  update: {
    status: () => ipcRenderer.invoke('update:status'),
    check:  () => ipcRenderer.invoke('update:check'),
    /** Install the staged build and come back on it. Resolves as the app quits,
     *  so the renderer should not expect anything after this. */
    apply:  () => ipcRenderer.invoke('update:apply'),
    /** Pushed whenever the updater moves — checking, downloading, staged. Same
     *  shape as `status()`, and returns an unsubscribe. */
    onStatus: (callback) => {
      const listener = (_event, status) => callback(status);
      ipcRenderer.on('update:status', listener);
      return () => ipcRenderer.removeListener('update:status', listener);
    },
  },
  /** Rolling on-disk snapshots of the stores — see electron/backups.cjs. */
  backup: {
    save:   (bundle) => ipcRenderer.invoke('backup:save', bundle),
    list:   ()       => ipcRenderer.invoke('backup:list'),
    read:   (name)   => ipcRenderer.invoke('backup:read', name),
    reveal: ()       => ipcRenderer.invoke('backup:reveal'),
  },
  /** Show a desktop notification — see electron/tray.cjs. */
  notify: (title, body) => ipcRenderer.invoke('notify', { title, body }),
  tray: {
    /** Push today's open count and the keep-running setting to the tray. */
    update: (state) => ipcRenderer.invoke('tray:update', state),
  },
});
