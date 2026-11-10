"use strict";

const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  shell,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
const { publicCapabilities } = require("../core/contract.cjs");
const {
  executeImageEdit,
  inspectImage,
  prepareRequest,
  publicRequest,
} = require("../core/runner.cjs");
const { createApiKeyStore } = require("./apiKeyStore.cjs");
const { createHistoryStore } = require("./historyStore.cjs");
const {
  createExecuteHandler,
  createPreviewDataUrl,
  errorResult,
  readOriginalImage,
} = require("./promptLabHandlers.cjs");
const { createRunRegistry } = require("./runRegistry.cjs");
const { createWorkspaceStore } = require("./workspaceStore.cjs");
const { createExperimentStorage } = require("./experimentStorage.cjs");

const isDev = !app.isPackaged;
const devEntryUrl = "http://127.0.0.1:5178/";
const packagedEntryPath = path.join(__dirname, "..", "dist", "index.html");
const packagedEntryUrl = pathToFileURL(packagedEntryPath).href;
let sessionApiKey = String(process.env.OPENAI_API_KEY || "").trim();
delete process.env.OPENAI_API_KEY;

app.enableSandbox();
// Stable isolated profile across development, portable upgrades and checkout changes.
if (!app.commandLine.hasSwitch("user-data-dir")) {
  app.setPath(
    "userData",
    path.join(app.getPath("appData"), "YMI Prompt Lab Standalone"),
  );
}

let mainWindow = null;
let apiKeyStore = null;
let historyStore = null;
let workspaceStore = null;
let experimentStorage = null;
const runRegistry = createRunRegistry();
const ownsProfile = app.requestSingleInstanceLock();
if (!ownsProfile) app.quit();
app.on("second-instance", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

function isAllowedNavigation(url) {
  try {
    const candidate = new URL(url);
    candidate.hash = "";
    return candidate.href === (isDev ? devEntryUrl : packagedEntryUrl);
  } catch {
    return false;
  }
}

function assertTrustedEvent(event) {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame ||
    !isAllowedNavigation(event.senderFrame.url)
  ) {
    throw Object.assign(
      new Error("Prompt Lab rejected an untrusted renderer request."),
      {
        code: "untrusted_renderer",
      },
    );
  }
}

async function apiKeyStatus() {
  const stored = await apiKeyStore.status();
  if (stored.configured && stored.readable) return stored;
  if (sessionApiKey)
    return {
      configured: true,
      readable: true,
      source: "session",
      errorCode: null,
    };
  return stored;
}

async function loadApiKey() {
  try {
    const stored = await apiKeyStore.load();
    if (stored) return stored;
  } catch (error) {
    if (!sessionApiKey) throw error;
  }
  return sessionApiKey || null;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1000,
    minHeight: 720,
    title: "YMI Image Prompt Lab",
    backgroundColor: "#f8f1e8",
    icon: path.join(__dirname, "..", "build", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = win;

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/developers\.openai\.com\//.test(url))
      shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (isAllowedNavigation(url)) return;
    event.preventDefault();
    if (/^https:\/\/developers\.openai\.com\//.test(url))
      shell.openExternal(url);
  });
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  if (isDev) win.loadURL(devEntryUrl);
  else win.loadFile(packagedEntryPath);
  return win;
}

function refreshHistoryStore() {
  runRegistry.clear();
  const roots = experimentStorage.roots();
  historyStore = createHistoryStore({
    evidenceRoot: roots.evidenceRoot,
    defaultOutputRoot: roots.outputRoot,
    previewDataUrl: createPreviewDataUrl,
    registerRunDirectory: runRegistry.register,
  });
}

function registerIpcHandlers() {
  ipcMain.handle("prompt-lab:view-input", async (event, input) => {
    assertTrustedEvent(event);
    const image = await inspectImage(input.path);
    experimentStorage.protectInput(image.path);
    if (input.sha256 && image.sha256 !== input.sha256)
      throw new Error(
        "Source image changed since it was selected or recorded.",
      );
    return {
      url: `data:${image.mime_type};base64,${image.bytes.toString("base64")}`,
      width: image.width,
      height: image.height,
    };
  });
  const workspaceHandlers = {
    workspace: () => workspaceStore.read(),
    "save-prompt": (value) => workspaceStore.savePrompt(value),
    "update-prompt": (value) => workspaceStore.updatePrompt(value),
    "save-case": (value) => workspaceStore.saveCase(value),
    "save-review": (value) => workspaceStore.saveReview(value),
  };
  for (const [name, handler] of Object.entries(workspaceHandlers)) {
    ipcMain.handle(`prompt-lab:${name}`, async (event, value) => {
      assertTrustedEvent(event);
      return handler(value);
    });
  }
  ipcMain.handle("prompt-lab:export-library", async (event) => {
    assertTrustedEvent(event);
    const choice = await dialog.showSaveDialog(mainWindow, {
      title: "Export prompt library (contains your prompt text)",
      defaultPath: "prompt-library.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (choice.canceled || !choice.filePath) return false;
    const state = await workspaceStore.read();
    await fs.writeFile(
      choice.filePath,
      JSON.stringify(
        {
          schemaVersion: 1,
          prompts: state.prompts.filter((p) => !p.deletedAt),
        },
        null,
        2,
      ),
      { flag: "wx" },
    );
    return true;
  });
  ipcMain.handle("prompt-lab:import-library", async (event) => {
    assertTrustedEvent(event);
    const choice = await dialog.showOpenDialog(mainWindow, {
      title: "Import prompt library or legacy experiment JSON",
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (choice.canceled) return null;
    const stat = await fs.stat(choice.filePaths[0]);
    if (stat.size > 16 * 1024 * 1024)
      throw new Error("Import file must be under 16 MB.");
    return workspaceStore.importPrompts(
      JSON.parse(await fs.readFile(choice.filePaths[0], "utf8")),
    );
  });
  ipcMain.handle("prompt-lab:import-history", async (event) => experimentStorage.exclusive(async () => {
    assertTrustedEvent(event);
    const choice = await dialog.showOpenDialog(mainWindow, {
      title: "Select the old prompt-lab-run-records folder (read-only source)",
      properties: ["openDirectory"],
    });
    if (choice.canceled) return null;
    const source = await fs.realpath(choice.filePaths[0]);
    const targetRoot = experimentStorage.roots().evidenceRoot;
    await fs.mkdir(targetRoot, { recursive: true });
    let imported = 0;
    let skipped = 0;
    for (const entry of await fs.readdir(source, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[A-Za-z0-9_.-]+$/.test(entry.name))
        continue;
      const from = path.join(source, entry.name);
      const to = path.join(targetRoot, entry.name);
      try {
        await fs.access(to);
        skipped++;
        continue;
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      const payload = {};
      try {
        for (const name of [
          "request.json",
          "evidence.json",
          "response.json",
          "REQUEST_STARTED.json",
          "local-history.json",
          "local-inputs.json",
        ]) {
          const filename = path.join(from, name);
          try {
            const stat = await fs.lstat(filename);
            if (!stat.isFile() || stat.size > 512 * 1024)
              throw new Error("Invalid record");
            payload[name] = await fs.readFile(filename, "utf8");
            JSON.parse(payload[name]);
          } catch (e) {
            if (e.code !== "ENOENT") throw e;
          }
        }
        const request = JSON.parse(payload["request.json"]);
        const evidence = JSON.parse(payload["evidence.json"]);
        if (
          !request.run_id ||
          request.run_id !== evidence.run_id ||
          !entry.name.startsWith(`${request.run_id}_`)
        )
          throw new Error("Invalid identity");
      } catch {
        skipped++;
        continue;
      }
      await fs.mkdir(to);
      for (const [name, data] of Object.entries(payload))
        await fs.writeFile(path.join(to, name), data, { flag: "wx" });
      imported++;
    }
    return { imported, skipped };
  }));
  ipcMain.handle("prompt-lab:boot", async (event) => {
    assertTrustedEvent(event);
    const status = await apiKeyStatus();
    return {
      capabilities: publicCapabilities(),
      apiKeyLoaded: status.configured && status.readable,
      apiKeyStatus: status,
      defaultOutputRoot: experimentStorage.roots().outputRoot,
      storageVersion: experimentStorage.roots().evidenceRoot,
      managedStorage: experimentStorage.roots().evidenceRoot !== path.join(app.getPath("userData"), "prompt-lab-run-records"),
    };
  });

  ipcMain.handle("prompt-lab:api-key-status", async (event) => {
    assertTrustedEvent(event);
    return apiKeyStatus();
  });

  ipcMain.handle("prompt-lab:save-api-key", async (event, value) => {
    assertTrustedEvent(event);
    const status = await apiKeyStore.save(value);
    sessionApiKey = "";
    return status;
  });

  ipcMain.handle("prompt-lab:remove-api-key", async (event) => {
    assertTrustedEvent(event);
    const confirmed = await dialog.showMessageBox(
      BrowserWindow.fromWebContents(event.sender),
      {
        type: "warning",
        title: "Remove saved API key?",
        message: "Remove the saved OpenAI API key from this Windows account?",
        detail:
          "Prompt Lab will not be able to send requests until a new key is saved.",
        buttons: ["Cancel", "Remove key"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      },
    );
    if (confirmed.response !== 1)
      return { removed: false, status: await apiKeyStatus() };
    sessionApiKey = "";
    return { removed: true, status: await apiKeyStore.remove() };
  });

  ipcMain.handle("prompt-lab:pick-images", async (event, role) => {
    assertTrustedEvent(event);
    const result = await dialog.showOpenDialog(
      BrowserWindow.fromWebContents(event.sender),
      {
        title:
          role === "target"
            ? "Choose Target image — image2 (face reference)"
            : "Choose Source image — image1 (original artwork)",
        properties: ["openFile"],
        filters: [
          {
            name: "OpenAI image inputs",
            extensions: ["png", "jpg", "jpeg", "webp"],
          },
        ],
      },
    );
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle("prompt-lab:pick-mask", async (event) => {
    assertTrustedEvent(event);
    const result = await dialog.showOpenDialog(
      BrowserWindow.fromWebContents(event.sender),
      {
        title: "Choose an optional PNG mask",
        properties: ["openFile"],
        filters: [{ name: "PNG mask", extensions: ["png"] }],
      },
    );
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("prompt-lab:pick-output-root", async (event, current) => {
    assertTrustedEvent(event);
    const result = await dialog.showOpenDialog(
      BrowserWindow.fromWebContents(event.sender),
      {
        title: "Choose where Prompt Lab runs are saved",
        defaultPath: current || app.getPath("documents"),
        properties: ["openDirectory", "createDirectory"],
      },
    );
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle(
    "prompt-lab:inspect-image",
    async (event, filePath, options) => {
      assertTrustedEvent(event);
      try {
        const image = await inspectImage(filePath, options);
        experimentStorage.protectInput(image.path);
        return {
          ok: true,
          image: {
            path: image.path,
            previewUrl: await createPreviewDataUrl(image.bytes),
            name: image.name,
            byte_count: image.byte_count,
            sha256: image.sha256,
            width: image.width,
            height: image.height,
            format: image.format,
            mime_type: image.mime_type,
            has_alpha: image.has_alpha,
          },
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  ipcMain.handle("prompt-lab:validate", async (event, request) => {
    assertTrustedEvent(event);
    try {
      const prepared = await prepareRequest(request);
      return { ok: true, request: publicRequest(prepared) };
    } catch (error) {
      return errorResult(error);
    }
  });

  const executeHandler = createExecuteHandler({
      prepareRequest,
      executeImageEdit,
      getApiKey: loadApiKey,
      reportProgress: (event, phase) => {
        try {
          if (!event.sender.isDestroyed())
            event.sender.send("prompt-lab:progress", phase);
        } catch {
          /* UI progress cannot change a paid request outcome. */
        }
      },
      getEvidenceRoot: () => experimentStorage.roots().evidenceRoot,
      registerRunDirectory: runRegistry.register,
      recordCompletedRun: async (result) => {
        await experimentStorage.recordGeneratedOutputs(result);
        return historyStore.recordCompletedRun(result);
      },
      confirmRequest: async (event, prepared) => {
        assertTrustedEvent(event);
        const confirmed = await dialog.showMessageBox(
          BrowserWindow.fromWebContents(event.sender),
          {
            type: "warning",
            title: "Send one paid OpenAI request?",
            message: `Send exactly one ${prepared.settings.model} image-edit request?`,
            detail: [
              `Size: ${prepared.settings.size}`,
              `Quality: ${prepared.settings.quality}`,
              `Outputs: ${prepared.settings.n}`,
              `Inputs: ${prepared.images.length}`,
              "Automatic retry: OFF",
              "If the outcome becomes unknown, the app will stop and will not resubmit.",
            ].join("\n"),
            buttons: ["Cancel", "Send one request"],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          },
        );
        return confirmed.response === 1;
      },
    });
  ipcMain.handle("prompt-lab:execute", async (event, request) => {
    assertTrustedEvent(event);
    try { return await experimentStorage.exclusive(() => executeHandler(event, request)); }
    catch (e) { return errorResult(e); }
  });

  ipcMain.handle("prompt-lab:storage-status", async (event) => {
    assertTrustedEvent(event);
    return experimentStorage.status();
  });
  ipcMain.handle("prompt-lab:plan-delete-run", async (event, runId) => {
    assertTrustedEvent(event);
    return experimentStorage.prepareDelete(runId);
  });
  ipcMain.handle("prompt-lab:delete-run", async (event, token, withImages) => {
    assertTrustedEvent(event);
    const result = await experimentStorage.deleteRun(token, withImages);
    if (result.deleted) {
      runRegistry.remove(result.runId);
      try { await workspaceStore.removeReview(result.runId); }
      catch { result.message = 'Experiment deleted. Its assessment note could not be cleaned up.'; }
    }
    return result;
  });
  ipcMain.handle("prompt-lab:pick-storage", async (event) => {
    assertTrustedEvent(event);
    const choice = await dialog.showOpenDialog(mainWindow, {
      title: "Choose a drive or folder for experiment data",
      properties: ["openDirectory", "createDirectory"],
    });
    if (choice.canceled || !choice.filePaths[0]) return null;
    return experimentStorage.prepareMigration(choice.filePaths[0]);
  });
  ipcMain.handle("prompt-lab:migrate-storage", async (event, token) => {
    assertTrustedEvent(event);
    const result = await experimentStorage.migrate(token);
    refreshHistoryStore();
    return result;
  });
  ipcMain.handle("prompt-lab:save-output", async (event, runId, file) => {
    assertTrustedEvent(event);
    return experimentStorage.exclusive(async () => {
      const image = await readOriginalImage(runRegistry, runId, file);
      const choice = await dialog.showSaveDialog(mainWindow, {
        title: "Save original generated image",
        defaultPath: file,
        filters: [{ name: "Image", extensions: [path.extname(file).slice(1)] }],
      });
      if (choice.canceled || !choice.filePath) return null;
      const encoded = image.url.slice(image.url.indexOf(',') + 1);
      // Create a new copy only; never overwrite an input or existing output.
      await fs.writeFile(choice.filePath, Buffer.from(encoded, 'base64'), { flag: 'wx' });
      return { saved: true };
    });
  });

  ipcMain.handle("prompt-lab:list-history", async (event) => {
    assertTrustedEvent(event);
    return historyStore.listHistory();
  });

  ipcMain.handle("prompt-lab:view-original", async (event, runId, file) => {
    assertTrustedEvent(event);
    return readOriginalImage(runRegistry, runId, file);
  });

  ipcMain.handle("prompt-lab:export-config", async (event, config) => {
    assertTrustedEvent(event);
    const result = await dialog.showSaveDialog(
      BrowserWindow.fromWebContents(event.sender),
      {
        title: "Export Prompt Lab experiment",
        defaultPath: `${String(config?.experimentName || "prompt-experiment").replace(/[^A-Za-z0-9_-]+/g, "-")}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      },
    );
    if (result.canceled || !result.filePath) return null;
    const exportValue = {
      schema_version: 1,
      exported_at: new Date().toISOString(),
      experiment_name: String(config?.experimentName || ""),
      prompt: String(config?.prompt || ""),
      settings: config?.settings || {},
    };
    await fs.writeFile(
      result.filePath,
      `${JSON.stringify(exportValue, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    return result.filePath;
  });

  ipcMain.handle("prompt-lab:import-config", async (event) => {
    assertTrustedEvent(event);
    const result = await dialog.showOpenDialog(
      BrowserWindow.fromWebContents(event.sender),
      {
        title: "Import Prompt Lab experiment",
        properties: ["openFile"],
        filters: [{ name: "JSON", extensions: ["json"] }],
      },
    );
    if (result.canceled || !result.filePaths[0]) return null;
    const value = JSON.parse(await fs.readFile(result.filePaths[0], "utf8"));
    if (
      value?.schema_version !== 1 ||
      typeof value.prompt !== "string" ||
      typeof value.settings !== "object"
    ) {
      throw new Error("Unsupported Prompt Lab config file.");
    }
    return {
      experimentName: String(value.experiment_name || ""),
      prompt: value.prompt,
      settings: value.settings,
    };
  });

  ipcMain.handle("prompt-lab:open-run-folder", async (event, runId) => {
    assertTrustedEvent(event);
    const target = runRegistry.resolve(runId);
    const result = await shell.openPath(target);
    if (result)
      throw Object.assign(new Error("The run folder could not be opened."), {
        code: "run_folder_open_failed",
      });
    return true;
  });
}

if (ownsProfile)
  app.whenReady().then(async () => {
    workspaceStore = createWorkspaceStore(app.getPath("userData"));
    apiKeyStore = createApiKeyStore({
      safeStorage,
      userDataPath: app.getPath("userData"),
    });
    experimentStorage = createExperimentStorage({
      profileRoot: app.getPath("userData"),
      protectedInputPaths: async () => (await workspaceStore.read()).cases.flatMap(c => [...c.images.map(i => i.path), c.mask?.path].filter(Boolean)),
      defaultOutputRoot: path.join(
        app.getPath("documents"),
        "YMI Prompt Lab Images",
      ),
    });
    await experimentStorage.init();
    refreshHistoryStore();
    registerIpcHandlers();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  }).catch((e) => {
    dialog.showErrorBox("Experiment storage unavailable", e.message);
    app.quit();
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
