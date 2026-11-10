"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createWorkspaceStore } = require("../electron/workspaceStore.cjs");
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "prompt-workspace-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, store: createWorkspaceStore(root) };
}
test("prompt edits retain immutable versions; favorite, trash and restore survive restart", async (t) => {
  const { root, store } = await fixture(t);
  let s = await store.savePrompt({
    title: "Identity",
    body: "Preserve background",
    tags: ["profile"],
    notes: "First test",
  });
  const id = s.prompts[0].id;
  await store.savePrompt({
    id,
    title: "Identity",
    body: "Preserve background and typography",
    changeNote: "Protect text",
  });
  await store.updatePrompt({ id, action: "favorite" });
  await store.updatePrompt({ id, action: "trash" });
  await assert.rejects(
    store.savePrompt({ id, title: "bad", body: "bad" }),
    /Restore/,
  );
  s = await store.updatePrompt({ id, action: "restore" });
  assert.equal(s.prompts[0].versions.length, 2);
  assert.equal(s.prompts[0].versions[0].body, "Preserve background");
  const recovered = await createWorkspaceStore(root).read();
  assert.equal(recovered.prompts[0].favorite, true);
  assert.equal(recovered.prompts[0].deletedAt, null);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(root, "workspace.json.bak"), "utf8"))
      .prompts[0].versions.length,
    2,
  );
});
test("concurrent local saves serialize without dropping prompts", async (t) => {
  const { store } = await fixture(t);
  await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      store.savePrompt({ title: `P${i}`, body: `B${i}` }),
    ),
  );
  assert.equal((await store.read()).prompts.length, 12);
});
test("imports sanitize extra fields and preserve versions; invalid import is atomic", async (t) => {
  const { store } = await fixture(t);
  await store.importPrompts([
    {
      name: "Old preset",
      prompt: "Hello",
      apiKey: "DO_NOT_COPY",
      versions: [{ title: "Old", body: "Before", changeNote: "Earlier" }],
    },
  ]);
  const before = await store.read();
  assert.equal(before.prompts[0].versions[0].body, "Before");
  assert.ok(!JSON.stringify(before).includes("DO_NOT_COPY"));
  await assert.rejects(
    store.importPrompts([{ title: "Good", body: "Good" }, { title: "Empty" }]),
  );
  assert.deepEqual(await store.read(), before);
});
test("case records keep hashes/order but omit image bytes; assessments persist separately", async (t) => {
  const { store } = await fixture(t);
  const s = await store.saveCase({
    title: "Side profile",
    images: [
      { path: "a.png", sha256: "HASH_A", bytes: "discard" },
      { path: "b.png", sha256: "HASH_B" },
    ],
  });
  assert.deepEqual(
    s.cases[0].images.map((v) => v.path),
    ["a.png", "b.png"],
  );
  assert.equal(s.cases[0].images[0].bytes, undefined);
  await store.saveReview({
    runId: "run_1",
    identity: "pass",
    structure: "issue",
    notes: "Changed lettering",
    favorite: true,
  });
  assert.equal((await store.read()).reviews.run_1.structure, "issue");
});
test("corrupt workspace fails closed and is not silently replaced", async (t) => {
  const { root, store } = await fixture(t);
  await fs.writeFile(path.join(root, "workspace.json"), "{broken");
  await assert.rejects(store.savePrompt({ title: "No", body: "No" }));
  assert.equal(
    await fs.readFile(path.join(root, "workspace.json"), "utf8"),
    "{broken",
  );
});
