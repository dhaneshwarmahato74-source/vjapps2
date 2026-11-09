'use strict';
// Only the local "blocked" page (file://) gets the uninstall/retry buttons – never the website itself.
const { contextBridge, ipcRenderer } = require('electron');
if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('dk', {
    uninstall: () => ipcRenderer.invoke('dk:uninstall'),
    retry: () => ipcRenderer.invoke('dk:retry'),
    quit: () => ipcRenderer.invoke('dk:quit')
  });
}
