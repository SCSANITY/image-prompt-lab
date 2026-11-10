"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { validateSettings } = require("../core/contract.cjs");
const empty = () => ({ schemaVersion: 1, prompts: [], cases: [], reviews: {} });
const text = (value, max = 32000) => String(value || "").slice(0, max);
const tags = (value) =>
  (Array.isArray(value) ? value : String(value || "").split(","))
    .map((v) => text(v, 80).trim())
    .filter(Boolean)
    .slice(0, 30);
function cleanSettings(value) {
  if (!value) return null;
  const { size_metadata, ...settings } = validateSettings(value);
  return settings;
}
function promptFields(value) {
  if (String(value.body ?? value.prompt ?? "").length > 32000)
    throw new Error("Prompt exceeds 32,000 characters; nothing was saved.");
  const title = text(value.title || value.name, 160).trim();
  const body = text(value.body ?? value.prompt).trim();
  if (!title || !body) throw new Error("A prompt needs a title and text.");
  return {
    title,
    body,
    notes: text(value.notes, 8000),
    tags: tags(value.tags),
    settings: cleanSettings(value.settings),
  };
}
function createWorkspaceStore(root) {
  const file = path.join(root, "workspace.json");
  let queue = Promise.resolve();
  async function read() {
    try {
      const stat = await fs.stat(file);
      if (stat.size > 32 * 1024 * 1024)
        throw new Error(
          "Workspace exceeds the supported size. Export and archive older experiments.",
        );
      const state = JSON.parse(await fs.readFile(file, "utf8"));
      if (
        state.schemaVersion !== 1 ||
        !Array.isArray(state.prompts) ||
        !Array.isArray(state.cases) ||
        !state.reviews
      )
        throw new Error(
          "Workspace is invalid. Restore a backup before editing.",
        );
      return state;
    } catch (e) {
      if (e.code === "ENOENT") return empty();
      throw e;
    }
  }
  function change(fn) {
    const result = queue.then(async () => {
      const state = await read();
      const outcome = await fn(state);
      const serialized = JSON.stringify(state, null, 2);
      if (Buffer.byteLength(serialized) > 32 * 1024 * 1024)
        throw new Error("Workspace size limit reached; no changes were saved.");
      await fs.mkdir(root, { recursive: true });
      const temp = `${file}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temp, serialized, { flag: "wx" });
        await fs.copyFile(file, `${file}.bak`).catch((e) => {
          if (e.code !== "ENOENT") throw e;
        });
        await fs.rename(temp, file);
      } finally {
        await fs.rm(temp, { force: true });
      }
      return outcome ?? state;
    });
    queue = result.catch(() => {});
    return result;
  }
  return {
    read: async () => {
      await queue;
      return read();
    },
    savePrompt: (input) =>
      change((state) => {
        const fields = promptFields(input);
        const now = new Date().toISOString();
        let item = input.id
          ? state.prompts.find((p) => p.id === input.id)
          : null;
        if (input.id && !item) throw new Error("Prompt no longer exists.");
        if (item?.deletedAt)
          throw new Error("Restore this prompt before editing.");
        if (!item) {
          item = {
            id: randomUUID(),
            createdAt: now,
            favorite: false,
            versions: [],
          };
          state.prompts.unshift(item);
        }
        const version = {
          id: randomUUID(),
          ...fields,
          savedAt: now,
          changeNote: text(input.changeNote, 1000),
        };
        Object.assign(item, fields, { updatedAt: now });
        item.versions.push(version);
      }),
    updatePrompt: ({ id, action }) =>
      change((state) => {
        const item = state.prompts.find((p) => p.id === id);
        if (!item) throw new Error("Prompt not found.");
        if (action === "favorite") item.favorite = !item.favorite;
        else if (action === "trash") item.deletedAt = new Date().toISOString();
        else if (action === "restore") item.deletedAt = null;
        else throw new Error("Unknown prompt action.");
      }),
    saveCase: (input) =>
      change((state) => {
        const title = text(input.title, 160).trim();
        if (!title) throw new Error("Name this test case.");
        if (
          !Array.isArray(input.images) ||
          input.images.length < 1 ||
          input.images.length > 16
        )
          throw new Error("Add 1–16 images first.");
        const image = (v) => ({
          path: text(v.path, 4000),
          sha256: text(v.sha256, 64),
          name: text(v.name, 256),
        });
        const data = {
          id: input.id || randomUUID(),
          title,
          tags: tags(input.tags),
          notes: text(input.notes, 8000),
          images: input.images.map(image),
          mask: input.mask ? image(input.mask) : null,
          updatedAt: new Date().toISOString(),
        };
        const index = state.cases.findIndex((c) => c.id === data.id);
        if (index < 0) state.cases.unshift(data);
        else state.cases[index] = data;
      }),
    removeReview: (runId) => change((state) => { delete state.reviews[runId]; }),
    saveReview: ({ runId, ...value }) =>
      change((state) => {
        if (!/^[A-Za-z0-9_-]{1,160}$/.test(runId))
          throw new Error("Invalid run ID.");
        const grade = (key) =>
          ["unrated", "pass", "issue"].includes(value[key])
            ? value[key]
            : "unrated";
        state.reviews[runId] = {
          identity: grade("identity"),
          structure: grade("structure"),
          naturalness: grade("naturalness"),
          favorite: Boolean(value.favorite),
          baseline: Boolean(value.baseline),
          tags: tags(value.tags),
          notes: text(value.notes, 8000),
        };
      }),
    importPrompts: (value) =>
      change((state) => {
        const list = Array.isArray(value) ? value : value.prompts || [value];
        if (list.length > 1000)
          throw new Error("Import at most 1,000 prompts at a time.");
        const items = list.map((p) => {
          const fields = promptFields({
            ...p,
            title: p.title || p.name || p.experiment_name || "Imported prompt",
          });
          const now = new Date().toISOString();
          const versions =
            Array.isArray(p.versions) && p.versions.length
              ? p.versions.map((v) => ({
                  ...promptFields(v),
                  id: randomUUID(),
                  savedAt: text(v.savedAt, 60) || now,
                  changeNote: text(v.changeNote, 1000),
                }))
              : [
                  {
                    ...fields,
                    id: randomUUID(),
                    savedAt: now,
                    changeNote: "Imported",
                  },
                ];
          return {
            ...fields,
            id: randomUUID(),
            favorite: Boolean(p.favorite),
            createdAt: now,
            updatedAt: now,
            versions,
          };
        });
        state.prompts.unshift(...items);
      }),
  };
}
module.exports = { createWorkspaceStore, promptFields };
