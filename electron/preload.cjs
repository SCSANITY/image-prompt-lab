'use strict'

const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('promptLab', {
  workspace: () => ipcRenderer.invoke('prompt-lab:workspace'),
  viewInput: value => ipcRenderer.invoke('prompt-lab:view-input', value),
  savePrompt: value => ipcRenderer.invoke('prompt-lab:save-prompt', value),
  updatePrompt: value => ipcRenderer.invoke('prompt-lab:update-prompt', value),
  saveCase: value => ipcRenderer.invoke('prompt-lab:save-case', value),
  saveReview: value => ipcRenderer.invoke('prompt-lab:save-review', value),
  exportLibrary: () => ipcRenderer.invoke('prompt-lab:export-library'),
  importLibrary: () => ipcRenderer.invoke('prompt-lab:import-library'),
  importHistory: () => ipcRenderer.invoke('prompt-lab:import-history'),
  pathForFile(file) {
    try { return webUtils.getPathForFile(file) || null } catch { return null }
  },
  boot: () => ipcRenderer.invoke('prompt-lab:boot'),
  apiKeyStatus: () => ipcRenderer.invoke('prompt-lab:api-key-status'),
  saveApiKey: (value) => ipcRenderer.invoke('prompt-lab:save-api-key', value),
  removeApiKey: () => ipcRenderer.invoke('prompt-lab:remove-api-key'),
  pickImages: role => ipcRenderer.invoke('prompt-lab:pick-images', role),
  pickMask: () => ipcRenderer.invoke('prompt-lab:pick-mask'),
  pickOutputRoot: (current) => ipcRenderer.invoke('prompt-lab:pick-output-root', current),
  inspectImage: (filePath, options) => ipcRenderer.invoke('prompt-lab:inspect-image', filePath, options),
  validate: (request) => ipcRenderer.invoke('prompt-lab:validate', request),
  execute: (request) => ipcRenderer.invoke('prompt-lab:execute', request),
  listHistory: () => ipcRenderer.invoke('prompt-lab:list-history'),
  viewOriginal: (runId, file) => ipcRenderer.invoke('prompt-lab:view-original', runId, file),
  onProgress: (callback) => {
    const listener = (_event, phase) => callback(phase)
    ipcRenderer.on('prompt-lab:progress', listener)
    return () => ipcRenderer.removeListener('prompt-lab:progress', listener)
  },
  exportConfig: (config) => ipcRenderer.invoke('prompt-lab:export-config', config),
  importConfig: () => ipcRenderer.invoke('prompt-lab:import-config'),
  openRunFolder: (runId) => ipcRenderer.invoke('prompt-lab:open-run-folder', runId),
})
