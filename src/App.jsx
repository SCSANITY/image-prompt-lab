import React, { useEffect, useRef, useState } from "react";
import ImageViewer from "./ImageViewer";
import Compare from "./Compare";
import InputSlots from "./InputSlots";
import appIcon from "../build/icon.svg";
import ExperimentDetails, { bytes } from "./ExperimentDetails";
import StorageDialog, { DeleteExperiment } from "./StorageDialogs";
const api = window.promptLab;
const FeedbackContext = React.createContext(null);
const phases = {
  validating: "Checking inputs",
  confirming: "Waiting for confirmation",
  requesting: "Waiting for OpenAI",
  receiving: "Downloading response",
  saving: "Saving files",
  previewing: "Preparing previews",
};
const blank = () => ({
  title: "",
  body: "",
  notes: "",
  tags: [],
  settings: null,
  changeNote: "",
});
const date = (v) => (v ? new Date(v).toLocaleString() : "—");
const cost = (v) =>
  typeof v === "number" ? `$${v.toFixed(4)}` : "Not reported";
export function Modal({ title, close, children, wide }) {
  const feedback = React.useContext(FeedbackContext);
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    ref.current.showModal();
    return () => prev?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button aria-label="Close dialog" onClick={close}>
          ×
        </button>
      </header>
      <div className="modal-body">
        {feedback?.error && (
          <p className="notice error" role="alert">
            {feedback.error}
          </p>
        )}
        {children}
      </div>
    </dialog>
  );
}
function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Empty({ title, children }) {
  return (
    <div className="empty">
      <span className="empty-icon">◇</span>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
export default function App() {
  const [detailRun, setDetailRun] = useState(null);
  const [deletePlan, setDeletePlan] = useState(null);
  const [maintenance, setMaintenance] = useState(false);
  const [expandedComposer, setExpandedComposer] = useState(false);
  const [boot, setBoot] = useState(null),
    [settings, setSettings] = useState(null),
    [page, setPage] = useState("studio");
  const [prompt, setPrompt] = useState(""),
    [name, setName] = useState("Untitled experiment"),
    [images, setImages] = useState([null, null]),
    [mask, setMask] = useState(null),
    [outputRoot, setOutputRoot] = useState("");
  const [ws, setWorkspace] = useState({
      prompts: [],
      cases: [],
      reviews: {},
    }),
    [history, setHistory] = useState([]),
    [run, setRun] = useState(null),
    [index, setOutputIndex] = useState(0);
  const [busy, setBusy] = useState(false),
    [phase, setPhase] = useState(""),
    [elapsed, setElapsed] = useState(0),
    [saving, setSaving] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [modal, setModal] = useState(null),
    [viewer, setViewer] = useState(null),
    [comparison, setComparison] = useState(null);
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [draft, setLibraryDraft] = useState(blank),
    [selected, setLibrarySelection] = useState(null),
    [dirty, setLibraryDirty] = useState(false),
    [version, setSelectedVersion] = useState(null);
  const [context, setExperimentContext] = useState({}),
    [caseDraft, setCaseDraft] = useState({
      title: "",
      tags: "",
      notes: "",
    }),
    [compareIds, setCompareIds] = useState([]),
    [review, setReview] = useState({}),
    [key, setKey] = useState(""),
    [valid, setValidated] = useState(false);
  const act = async (fn) => {
    setError("");
    setNotice("");
    try {
      return await fn();
    } catch (e) {
      setError(e.message || "Operation failed.");
      return null;
    }
  };
  const refresh = async () => setHistory(await api.listHistory());
  useEffect(() => {
    if (!api) return;
    act(async () => {
      const b = await api.boot();
      setBoot(b);
      let saved;
      try {
        saved = JSON.parse(localStorage.getItem("prompt-lab-draft-v2"));
      } catch {
        /* defaults */
      }
      setSettings({
        ...b.capabilities.defaults,
        ...saved?.settings,
      });
      setPrompt(saved?.prompt || "");
      setName(saved?.name || "Untitled experiment");
      const sameStorage = saved?.storageVersion === b.storageVersion || (!saved?.storageVersion && !b.managedStorage);
      setOutputRoot((sameStorage && saved?.outputRoot) || b.defaultOutputRoot);
      setWorkspace(await api.workspace());
      await refresh();
    });
    return api.onProgress(setPhase);
  }, []);
  useEffect(() => {
    if (!settings) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          "prompt-lab-draft-v2",
          JSON.stringify({
            settings,
            prompt,
            name,
            outputRoot,
            storageVersion: boot?.storageVersion,
          }),
        );
      } catch {
        setError("Draft storage unavailable. Save your prompt in the library.");
      }
    }, 250);
    return () => clearTimeout(t);
  }, [settings, prompt, name, outputRoot, boot?.storageVersion]);
  useEffect(() => {
    setValidated(false);
  }, [settings, prompt, images, mask]);
  useEffect(() => {
    if (!busy) return;
    const start = performance.now();
    setElapsed(0);
    const t = setInterval(
      () => setElapsed((performance.now() - start) / 1000),
      100,
    );
    return () => clearInterval(t);
  }, [busy]);
  useEffect(() => {
    setReview(ws.reviews[run?.runId] || {});
  }, [run?.runId, ws.reviews]);
  const navigate = (p) => {
    setPage(p);
    setSearch("");
    setFilter("all");
  };
  const setting = (k, v) =>
    setSettings((s) => ({
      ...s,
      [k]: v,
    }));
  const edit = (patch) => {
    setLibraryDraft((d) => ({
      ...d,
      ...patch,
    }));
    setLibraryDirty(true);
  };
  const discard = () =>
    !dirty || window.confirm("Discard unsaved library edits?");
  const inspect = async (paths) => {
    const result = [];
    for (const path of paths) {
      const r = await api.inspectImage(path);
      if (!r.ok) throw new Error(r.error.message);
      result.push(r.image);
    }
    return result;
  };
  const changeInput = (slot, image) => {
    setImages((previous) =>
      previous.map((value, i) => (i === slot ? image : value)),
    );
    if (slot === 0) setMask(null);
    setExperimentContext((c) => ({
      ...c,
      caseId: "",
    }));
  };
  const inputsReady = images.every(Boolean);
  const assignInput = (slot, paths) =>
    act(async () => {
      if (!paths.length) return;
      if (paths.length !== 1)
        throw new Error("Choose one image for this slot.");
      const [image] = await inspect(paths);
      changeInput(slot, image);
    });
  const selectInput = (slot) =>
    act(async () =>
      assignInput(slot, await api.pickImages(slot === 0 ? "source" : "target")),
    );
  const loadInputs = async (entries, savedMask) => {
    if (entries.length > 2)
      throw new Error(
        "This saved experiment has more than two inputs. View it in history; choose its Source and Target images explicitly for a new experiment.",
      );
    const list = await inspect(entries.map((v) => v.path));
    if (
      list.length !== entries.length ||
      list.some((v, i) => entries[i].sha256 && entries[i].sha256 !== v.sha256)
    )
      throw new Error(
        "A saved source image changed. Re-add the intended files before continuing.",
      );
    let m = null;
    if (savedMask) {
      const r = await api.inspectImage(savedMask.path, {
        isMask: true,
      });
      if (!r.ok) throw new Error(r.error.message);
      if (savedMask.sha256 && savedMask.sha256 !== r.image.sha256)
        throw new Error("Saved mask has changed.");
      m = r.image;
    }
    setImages([list[0] || null, list[1] || null]);
    setMask(m);
  };
  const loadPrompt = (p, includeSettings = false) => {
    if (
      prompt.trim() &&
      prompt !== p.body &&
      !window.confirm("Replace the current composer text?")
    )
      return;
    setPrompt(p.body);
    setName(p.title);
    if (includeSettings && p.settings)
      setSettings({
        ...boot.capabilities.defaults,
        ...p.settings,
      });
    setExperimentContext((c) => ({
      ...c,
      promptId: p.promptId || p.id || "",
      versionId: p.versionId || p.versions?.at(-1)?.id || "",
    }));
    setModal(null);
    navigate("studio");
    setNotice("Prompt loaded. Input files and destination are unchanged.");
  };
  const execute = async (dry) => {
    if (maintenance) return;
    if (!inputsReady) {
      setError("Add both Source image (image1) and Target image (image2).");
      return;
    }
    setBusy(true);
    setPhase("validating");
    await act(async () => {
      const payload = {
        experimentName: name,
        prompt,
        settings,
        imagePaths: images.map((v) => v.path),
        maskPath: mask?.path,
        expectedInputHashes: images.map((v) => v.sha256),
        expectedMaskHash: mask?.sha256,
        outputRoot,
        experimentContext: context,
      };
      const r = await (dry ? api.validate(payload) : api.execute(payload));
      if (r.cancelled) {
        setNotice("Cancelled before sending.");
        return;
      }
      if (!r.ok)
        throw new Error(
          `${r.error.message}${r.error.runId ? ` Run: ${r.error.runId}.` : ""}${r.error.providerRequestId ? ` Request: ${r.error.providerRequestId}.` : ""}`,
        );
      if (dry) {
        setValidated(true);
        setNotice("Local checks passed. No request was sent.");
        return;
      }
      const v = r.result;
      setRun({
        runId: v.runId,
        experimentName: name,
        prompt: v.request.prompt,
        settings: v.request.parameters,
        model: v.request.parameters.model,
        size: v.request.parameters.size,
        quality: v.request.parameters.quality,
        outputs: v.outputs,
        inputs: images.map((i) => ({
          path: i.path,
          sha256: i.sha256,
          name: i.name,
        })),
        mask: mask
          ? {
              path: mask.path,
              sha256: mask.sha256,
            }
          : null,
        providerTimingMs: v.evidence.provider_timing_ms,
        calculatedChargeUsd: v.evidence.calculated_charge_usd,
        providerRequestId: v.evidence.provider_request_id,
        transportCalls: v.evidence.transport_calls,
        result: "success",
        folderAvailable: v.localArtifactsAvailable,
        completedAt: new Date().toISOString(),
        ...context,
      });
      setOutputIndex(0);
      setNotice(
        v.localArtifactsAvailable
          ? "Completed. Images saved locally."
          : "Response received; local files could not be verified. Do not automatically resend.",
      );
    });
    if (!dry) {
      try {
        await refresh();
      } catch {
        /* retain original outcome */
      }
    }
    setBusy(false);
  };
  const savePrompt = async () => {
    setSaving(true);
    await act(async () => {
      const state = await api.savePrompt({
        ...draft,
        id: selected,
      });
      setWorkspace(state);
      const p = selected
        ? state.prompts.find((p) => p.id === selected)
        : state.prompts[0];
      setLibrarySelection(p.id);
      setLibraryDraft({
        ...p,
        changeNote: "",
      });
      setLibraryDirty(false);
      setNotice("Prompt version saved.");
    });
    setSaving(false);
  };
  const compare = (left, right, slider = false) =>
    act(async () => {
      const original = async (entry) => {
        if (entry.runId) {
          if (!entry.outputs?.length)
            throw new Error("No completed output to compare.");
          return api.viewOriginal(entry.runId, entry.outputs[0].file);
        }
        return api.viewInput({
          path: entry.path,
          sha256: entry.sha256,
        });
      };
      const [a, b] = await Promise.all([original(left), original(right)]);
      setComparison({
        left: {
          ...a,
          label: left.experimentName || left.name || "Source",
          prompt: left.prompt,
          settings: left.settings,
        },
        right: {
          ...b,
          label: right.experimentName,
          prompt: right.prompt,
          settings: right.settings,
        },
        slider,
      });
    });
  const reuseRun = (savedRun) => act(async () => {
    if (prompt && !window.confirm("Replace the next experiment with this saved run?")) return;
    if (savedRun.inputs?.length) await loadInputs(savedRun.inputs, savedRun.mask);
    setPrompt(savedRun.prompt);
    setSettings({ ...boot.capabilities.defaults, ...savedRun.settings });
    setName(`${savedRun.experimentName} · next`);
    setExperimentContext({ caseId: savedRun.caseId || "", promptId: savedRun.promptId || "", versionId: savedRun.versionId || "" });
    setRun(savedRun); setOutputIndex(0); setDetailRun(null); navigate("studio");
    setNotice(savedRun.inputs?.length ? "Saved input hashes verified. Experiment loaded." : "Legacy record has no source references. Current images are unchanged; verify them before sending.");
  });
  const reviewDeletion = (savedRun) => act(async () => {
    const plan = await api.planDeleteRun(savedRun.runId);
    setDetailRun(null); setDeletePlan(plan);
  });
  const deleted = async (result) => {
    setDeletePlan(null);
    if (result.deleted) {
      setRun(current => current?.runId === result.runId ? null : current);
      setCompareIds(ids => ids.filter(id => id !== result.runId));
      setWorkspace(await api.workspace());
    }
    await refresh();
    setNotice(`${result.deleted ? "Experiment deleted." : "Deletion could not finish."} Released ${bytes(result.removedBytes)}.${result.protectedImages ? ` ${result.protectedImages} protected or unverified image(s) kept.` : ""} ${result.message || ""}`);
  };
  const storageChanged = async () => {
    const nextBoot = await api.boot();
    setBoot(nextBoot); setOutputRoot(nextBoot.defaultOutputRoot);
    setRun(null); setCompareIds([]);
    await refresh();
  };
  const output = run?.outputs?.[index],
    active = ws.prompts.find((p) => p.id === selected);
  const prompts = ws.prompts.filter(
    (p) =>
      (filter === "trash" ? p.deletedAt : !p.deletedAt) &&
      (filter !== "favorites" || p.favorite) &&
      `${p.title} ${p.body} ${p.notes} ${p.tags.join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const runs = history.filter(
    (r) =>
      `${r.experimentName} ${r.prompt} ${r.model} ${(ws.reviews[r.runId]?.tags || []).join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (filter !== "favorites" || ws.reviews[r.runId]?.favorite) &&
      (filter !== "issues" ||
        ["identity", "structure", "naturalness"].some(
          (k) => ws.reviews[r.runId]?.[k] === "issue",
        )),
  );
  if (!api)
    return (
      <Empty title="Open the desktop app">
        Use START_PROMPT_LAB.ps1 or the portable executable.
      </Empty>
    );
  if (!boot || !settings)
    return (
      <Empty title={error ? "Unable to open workspace" : "Opening Prompt Lab"}>
        {error || "Loading your local workspace…"}
      </Empty>
    );
  const importLibrary = () =>
    act(async () => {
      const state = await api.importLibrary();
      if (state) {
        setWorkspace(state);
        setNotice("Prompts imported as new entries.");
        setModal(null);
      }
    });
  return (
    <FeedbackContext.Provider value={{ error }}>
      <div className="app-shell">
        <header className="topbar">
          <div className="brand">
            <img className="brand-icon" src={appIcon} alt="" aria-hidden="true" />
            <div>
              <strong>Prompt Lab</strong>
              <small>IMAGE EXPERIMENT WORKSPACE</small>
            </div>
          </div>
          <nav aria-label="Main navigation">
            {[
              ["studio", "Workspace"],
              ["library", "Prompt library"],
              ["history", "Experiments"],
            ].map(([id, label]) => (
              <button
                key={id}
                aria-current={page === id ? "page" : undefined}
                onClick={() => navigate(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          <button onClick={() => setModal("connection")}>
            <span className={`dot ${boot.apiKeyLoaded ? "ready" : ""}`} />
            {boot.apiKeyLoaded ? "Connected" : "Connect API"}
          </button>
        </header>
        {(error || notice) && (
          <div
            className={`notice ${error ? "error" : ""}`}
            role={error ? "alert" : "status"}
          >
            <span>{error || notice}</span>
            <button
              aria-label="Dismiss notification"
              onClick={() => {
                setError("");
                setNotice("");
              }}
            >
              ×
            </button>
          </div>
        )}
        {page === "studio" && (
          <main className="studio">
            <aside className="sources panel">
              <div className="panel-heading">
                <h2>Test inputs</h2>
                <span className="input-count">
                  {images.filter(Boolean).length} / 2
                </span>
              </div>
              <p className="muted">
                Transfer the Target face into the Source artwork.
              </p>
              <div className="actions">
                <button disabled={busy} onClick={() => setModal("cases")}>
                  Open case
                </button>
                <button
                  disabled={busy || !inputsReady}
                  onClick={() => {
                    setCaseDraft({
                      title: name,
                      tags: "",
                      notes: "",
                    });
                    setModal("save-case");
                  }}
                >
                  Save case
                </button>
              </div>
              <InputSlots
                images={images}
                busy={busy}
                select={selectInput}
                drop={(slot, files) =>
                  assignInput(slot, files.map(api.pathForFile).filter(Boolean))
                }
                remove={(slot) => changeInput(slot, null)}
                view={(image) =>
                  act(async () =>
                    setViewer({
                      ...(await api.viewInput(image)),
                      file: image.name,
                    }),
                  )
                }
              />
              <div className="source-bottom">
                <button
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      const path = await api.pickMask();
                      if (!path) return;
                      const r = await api.inspectImage(path, {
                        isMask: true,
                      });
                      if (!r.ok) throw new Error(r.error.message);
                      setMask(r.image);
                      setExperimentContext((c) => ({
                        ...c,
                        caseId: "",
                      }));
                    })
                  }
                >
                  {mask ? "Replace mask" : "＋ Optional mask"}
                </button>
                {mask && (
                  <p>
                    {mask.name}
                    <button
                      disabled={busy}
                      onClick={() => {
                        setMask(null);
                        setExperimentContext((c) => ({
                          ...c,
                          caseId: "",
                        }));
                      }}
                    >
                      Remove
                    </button>
                  </p>
                )}
                <small>Mask applies to Source / image1. Source files stay unchanged.</small>
              </div>
            </aside>
            <section
              className={`center-column ${expandedComposer ? "expanded-composer" : ""}`}
            >
              <div className="result-panel panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">
                      {run ? "VIEWING SAVED RUN" : "RESULT CANVAS"}
                    </span>
                    <h2>{run?.experimentName || "Make room for discovery"}</h2>
                  </div>
                  {output && (
                    <div className="actions">
                      <button
                        onClick={() =>
                          act(async () =>
                            setViewer({
                              ...(await api.viewOriginal(
                                run.runId,
                                output.file,
                              )),
                              file: output.file,
                            }),
                          )
                        }
                      >
                        View original
                      </button>
                      <button
                        disabled={!run.inputs?.length}
                        onClick={() =>
                          compare(
                            run.inputs[0],
                            {
                              ...run,
                              outputs: [output],
                            },
                            true,
                          )
                        }
                      >
                        Compare source
                      </button>
                      {run.inputs?.length > 1 && (
                        <button
                          onClick={() =>
                            compare(run.inputs[1], {
                              ...run,
                              outputs: [output],
                            })
                          }
                        >
                          Compare face
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="result-stage">
                  {busy ? (
                    <div className="empty">
                      <span className="spinner" />
                      <h2>{phases[phase] || "Working"}</h2>
                      <p>
                        {elapsed.toFixed(1)} s · Includes confirmation and local
                        processing
                      </p>
                      <small>One request. No automatic retries.</small>
                    </div>
                  ) : output?.previewUrl ? (
                    <img
                      src={output.previewUrl}
                      alt="Selected generated output"
                    />
                  ) : (
                    <Empty
                      title={
                        run
                          ? "No image available"
                          : "Your next experiment starts here"
                      }
                    >
                      {run
                        ? "Inspect the run status and local output folder."
                        : "Choose inputs, load a prompt, and observe what changes."}
                    </Empty>
                  )}
                </div>
                {run?.outputs?.length > 1 && (
                  <div className="filmstrip">
                    {run.outputs.map((v, i) => (
                      <button
                        key={v.file}
                        className={i === index ? "active" : ""}
                        onClick={() => setOutputIndex(i)}
                      >
                        {v.previewUrl && <img src={v.previewUrl} alt="" />}
                        Output {i + 1}
                      </button>
                    ))}
                  </div>
                )}
                {run && (
                  <div className="result-footer">
                    <span>{date(run.completedAt || run.createdAt)}</span>
                    <button
                      disabled={!run.folderAvailable}
                      onClick={() => act(() => api.openRunFolder(run.runId))}
                    >
                      Open image folder ↗
                    </button>
                  </div>
                )}
              </div>
              <section className="composer panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">NEXT EXPERIMENT</span>
                    <button
                      className="editor-size"
                      onClick={() => setExpandedComposer((v) => !v)}
                      aria-expanded={expandedComposer}
                    >
                      {expandedComposer ? "Compact editor" : "Expand editor"}
                    </button>
                    <input
                      aria-label="Experiment name"
                      className="title-input"
                      disabled={busy}
                      value={name}
                      maxLength={120}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="actions">
                    <button
                      disabled={busy}
                      onClick={() => {
                        setSearch("");
                        setModal("pick-prompt");
                      }}
                    >
                      From library
                    </button>
                    <button
                      disabled={busy || !prompt.trim()}
                      onClick={() => {
                        if (!discard()) return;
                        setLibrarySelection(null);
                        setLibraryDraft({
                          ...blank(),
                          title: name,
                          body: prompt,
                          settings,
                        });
                        setLibraryDirty(true);
                        navigate("library");
                      }}
                    >
                      Save prompt
                    </button>
                    <button
                      disabled={busy || !prompt}
                      onClick={() => {
                        if (
                          window.confirm(
                            "Clear composer text? Saved library prompts are kept.",
                          )
                        ) {
                          setPrompt("");
                          setExperimentContext((c) => ({
                            ...c,
                            promptId: "",
                            versionId: "",
                          }));
                        }
                      }}
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <textarea
                  aria-label="Experiment prompt"
                  disabled={busy}
                  value={prompt}
                  maxLength={32000}
                  onChange={(e) => {
                    setPrompt(e.target.value);
                    setExperimentContext((c) => ({
                      ...c,
                      promptId: "",
                      versionId: "",
                    }));
                  }}
                  placeholder="image1 is the source artwork. image2 is the target face reference. Describe the face transfer and what must stay unchanged…"
                />
                <div className="composer-bottom">
                  <div>
                    <button
                      disabled={busy}
                      onClick={() => setModal("settings")}
                    >
                      {settings.size} · {settings.quality} ·{" "}
                      {settings.output_format.toUpperCase()} ⚙
                    </button>
                    <small>{prompt.length.toLocaleString()} / 32,000</small>
                  </div>
                  <div className="actions">
                    <button
                      disabled={busy || !inputsReady}
                      onClick={() => execute(true)}
                    >
                      {valid ? "✓ Validated" : "Validate"}
                    </button>
                    <button
                      className="primary"
                disabled={busy || maintenance || !inputsReady || !boot.apiKeyLoaded}
                      onClick={() => execute(false)}
                    >
                      {busy ? "Running…" : "Generate image"}
                    </button>
                  </div>
                </div>
              </section>
            </section>
            <aside className="inspector panel">
              <span className="eyebrow">SELECTED RUN</span>
              <h2>Observation desk</h2>
              {!run ? (
                <p className="muted">
                  Run details and your assessment appear here, separate from the
                  next experiment’s settings.
                </p>
              ) : (
                <>
                  <dl>
                    <dt>Status</dt>
                    <dd>{run.result}</dd>
                    <dt>Model</dt>
                    <dd>{run.model}</dd>
                    <dt>Size / quality</dt>
                    <dd>
                      {run.size} · {run.quality}
                    </dd>
                    <dt>Response + decoding</dt>
                    <dd>
                      {typeof run.providerTimingMs === "number"
                        ? `${(run.providerTimingMs / 1000).toFixed(2)} s`
                        : "Not reported"}
                    </dd>
                    <dt>Estimated cost</dt>
                    <dd>{cost(run.calculatedChargeUsd)}</dd>
                    {output && (
                      <>
                        <dt>Selected image</dt>
                        <dd>
                          {output.width} × {output.height} ·{" "}
                          {((output.byte_count || 0) / 1024).toFixed(0)} KB
                        </dd>
                      </>
                    )}
                  </dl>
                  <button onClick={() => setModal("run-details")}>
                    Full run details
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        if (
                          prompt &&
                          !window.confirm(
                            "Replace the next experiment with this saved run?",
                          )
                        )
                          return;
                        if (run.inputs?.length)
                          await loadInputs(run.inputs, run.mask);
                        setPrompt(run.prompt);
                        setSettings({
                          ...boot.capabilities.defaults,
                          ...run.settings,
                        });
                        setName(`${run.experimentName} · next`);
                        setExperimentContext({
                          caseId: run.caseId || "",
                          promptId: run.promptId || "",
                          versionId: run.versionId || "",
                        });
                        setNotice(
                          run.inputs?.length
                            ? "Saved input hashes verified. Experiment loaded."
                            : "Legacy record has no source references. Current images are unchanged; verify them before sending.",
                        );
                      })
                    }
                  >
                    Use as next experiment
                  </button>
                  <hr />
                  <h3>Your assessment</h3>
                  {[
                    ["identity", "Identity likeness"],
                    ["structure", "Illustration preserved"],
                    ["naturalness", "Natural integration"],
                  ].map(([id, label]) => (
                    <Field key={id} label={label}>
                      <select
                        value={review[id] || "unrated"}
                        onChange={(e) =>
                          setReview((r) => ({
                            ...r,
                            [id]: e.target.value,
                          }))
                        }
                      >
                        <option value="unrated">Not evaluated</option>
                        <option value="pass">Pass</option>
                        <option value="issue">Needs improvement</option>
                      </select>
                    </Field>
                  ))}
                  <Field label="Issue tags">
                    <input
                      value={(review.tags || []).join(",")}
                      onChange={(e) =>
                        setReview((r) => ({
                          ...r,
                          tags: e.target.value.split(","),
                        }))
                      }
                      placeholder="background changed, face mismatch"
                    />
                  </Field>
                  <Field label="Observation notes">
                    <textarea
                      rows={3}
                      value={review.notes || ""}
                      onChange={(e) =>
                        setReview((r) => ({
                          ...r,
                          notes: e.target.value,
                        }))
                      }
                    />
                  </Field>
                  {[
                    ["favorite", "Favorite result"],
                    ["baseline", "Mark as baseline"],
                  ].map(([id, label]) => (
                    <label className="check" key={id}>
                      <input
                        type="checkbox"
                        checked={!!review[id]}
                        onChange={(e) =>
                          setReview((r) => ({
                            ...r,
                            [id]: e.target.checked,
                          }))
                        }
                      />
                      {label}
                    </label>
                  ))}
                  <button
                    className="primary"
                    onClick={() =>
                      act(async () => {
                        setWorkspace(
                          await api.saveReview({
                            runId: run.runId,
                            ...review,
                          }),
                        );
                        setNotice("Assessment saved.");
                      })
                    }
                  >
                    Save assessment
                  </button>
                </>
              )}
            </aside>
          </main>
        )}
        {page === "library" && (
          <main className="page">
            <div className="page-heading">
              <div>
                <span className="eyebrow">A HOME FOR YOUR IDEAS</span>
                <h1>Prompt library</h1>
                <p className="muted">Keep what works. Know what changed.</p>
              </div>
              <div className="actions">
                <button onClick={importLibrary}>Import</button>
                <button
                  onClick={() =>
                    act(async () => {
                      if (await api.exportLibrary())
                        setNotice("Library exported with version history.");
                    })
                  }
                >
                  Export library
                </button>
                <button
                  className="primary"
                  onClick={() => {
                    if (!discard()) return;
                    setLibrarySelection(null);
                    setLibraryDraft(blank());
                    setLibraryDirty(false);
                    setSelectedVersion(null);
                  }}
                >
                  ＋ New prompt
                </button>
              </div>
            </div>
            <div className="library-layout">
              <aside className="panel library-list">
                <input
                  aria-label="Search prompts"
                  placeholder="Search prompts, tags, notes…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="segmented">
                  {[
                    ["all", "All"],
                    ["favorites", "★"],
                    ["trash", "Trash"],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      className={filter === id ? "active" : ""}
                      onClick={() => setFilter(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {prompts.map((p) => (
                  <button
                    className={`list-card ${selected === p.id ? "selected" : ""}`}
                    key={p.id}
                    onClick={() => {
                      if (!discard()) return;
                      setLibrarySelection(p.id);
                      setLibraryDraft({
                        ...p,
                        changeNote: "",
                      });
                      setLibraryDirty(false);
                      setSelectedVersion(null);
                    }}
                  >
                    <strong>
                      {p.favorite ? "★ " : ""}
                      {p.title}
                    </strong>
                    <span>{p.tags.join(" · ") || "No tags"}</span>
                    <small>
                      {p.versions.length} versions · {date(p.updatedAt)}
                    </small>
                  </button>
                ))}
                {!prompts.length && (
                  <p className="muted">No prompts here yet.</p>
                )}
              </aside>
              <section className="panel library-editor">
                <div className="panel-heading">
                  <h2>
                    {selected ? "Edit & iterate" : "Create a prompt"}
                    {dirty ? " •" : ""}
                  </h2>
                  {active && (
                    <div className="actions">
                      <button
                        onClick={() =>
                          act(async () =>
                            setWorkspace(
                              await api.updatePrompt({
                                id: active.id,
                                action: "favorite",
                              }),
                            ),
                          )
                        }
                      >
                        {active.favorite ? "★ Saved" : "☆ Favorite"}
                      </button>
                      <button
                        onClick={() =>
                          act(async () => {
                            if (!discard()) return;
                            setWorkspace(
                              await api.updatePrompt({
                                id: active.id,
                                action: active.deletedAt ? "restore" : "trash",
                              }),
                            );
                            setLibrarySelection(null);
                            setLibraryDraft(blank());
                            setLibraryDirty(false);
                          })
                        }
                      >
                        {active.deletedAt ? "Restore" : "Move to trash"}
                      </button>
                    </div>
                  )}
                </div>
                <Field label="Title">
                  <input
                    value={draft.title}
                    onChange={(e) =>
                      edit({
                        title: e.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="Prompt">
                  <textarea
                    className="library-body"
                    value={draft.body}
                    maxLength={32000}
                    onChange={(e) =>
                      edit({
                        body: e.target.value,
                      })
                    }
                  />
                </Field>
                <div className="field-grid">
                  <Field label="Tags (comma separated)">
                    <input
                      value={draft.tags.join(",")}
                      onChange={(e) =>
                        edit({
                          tags: e.target.value.split(","),
                        })
                      }
                    />
                  </Field>
                  <Field label="Version note">
                    <input
                      value={draft.changeNote}
                      onChange={(e) =>
                        edit({
                          changeNote: e.target.value,
                        })
                      }
                      placeholder="What changed and why?"
                    />
                  </Field>
                </div>
                <Field label="Usage notes">
                  <textarea
                    rows={3}
                    value={draft.notes}
                    onChange={(e) =>
                      edit({
                        notes: e.target.value,
                      })
                    }
                  />
                </Field>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={!!draft.settings}
                    onChange={(e) =>
                      edit({
                        settings: e.target.checked ? settings : null,
                      })
                    }
                  />
                  Attach next experiment’s settings
                </label>
                <div className="actions wrap">
                  <button
                    className="primary"
                    disabled={saving || !!active?.deletedAt}
                    onClick={savePrompt}
                  >
                    {saving ? "Saving…" : "Save new version"}
                  </button>
                  <button
                    disabled={busy || !draft.body || !!active?.deletedAt}
                    onClick={() =>
                      loadPrompt({
                        ...draft,
                        id: dirty ? "" : selected,
                        versions: dirty ? [] : active?.versions,
                      })
                    }
                  >
                    Load text
                  </button>
                  <button
                    disabled={
                      busy ||
                      !draft.body ||
                      !draft.settings ||
                      !!active?.deletedAt
                    }
                    onClick={() =>
                      loadPrompt(
                        {
                          ...draft,
                          id: dirty ? "" : selected,
                          versions: dirty ? [] : active?.versions,
                        },
                        true,
                      )
                    }
                  >
                    Load text & settings
                  </button>
                  <button
                    disabled={!selected}
                    onClick={() => {
                      setLibrarySelection(null);
                      setLibraryDraft((d) => ({
                        ...d,
                        title: `${d.title} (copy)`,
                        changeNote: "",
                      }));
                      setLibraryDirty(true);
                      setSelectedVersion(null);
                    }}
                  >
                    Duplicate
                  </button>
                </div>
              </section>
              <aside className="panel version-list">
                <h2>Version history</h2>
                <p className="muted">Previous versions stay intact.</p>
                {[...(active?.versions || [])].reverse().map((v, i, list) => (
                  <button
                    className={`list-card ${version?.id === v.id ? "selected" : ""}`}
                    key={v.id}
                    onClick={() => setSelectedVersion(v)}
                  >
                    <strong>Version {list.length - i}</strong>
                    <span>{v.changeNote || "No change note"}</span>
                    <small>{date(v.savedAt)}</small>
                  </button>
                ))}
                {version && (
                  <div className="version-preview">
                    <pre>{version.body}</pre>
                    <button
                      disabled={busy || !!active?.deletedAt}
                      onClick={() =>
                        loadPrompt({
                          ...version,
                          promptId: active.id,
                          versionId: version.id,
                        })
                      }
                    >
                      Load this version
                    </button>
                    <button
                      onClick={() => {
                        if (!discard()) return;
                        setLibraryDraft((d) => ({
                          ...d,
                          ...version,
                          changeNote: "Based on an earlier version",
                        }));
                        setLibraryDirty(true);
                      }}
                    >
                      Use as editing draft
                    </button>
                    <details>
                      <summary>Compare with editing draft</summary>
                      <div className="text-compare">
                        <div>
                          <small>Saved version</small>
                          <pre>{version.body}</pre>
                        </div>
                        <div>
                          <small>Editing draft</small>
                          <pre>{draft.body}</pre>
                        </div>
                      </div>
                    </details>
                  </div>
                )}
              </aside>
            </div>
          </main>
        )}
        {page === "history" && (
          <main className="page">
            <div className="page-heading">
              <div>
                <span className="eyebrow">OBSERVE · COMPARE · REFINE</span>
                <h1>Experiments</h1>
                <p className="muted">
                  Latest 50 runs · Click a card to inspect. Older files remain on disk until you delete them.
                </p>
              </div>
              <div className="actions">
                <button disabled={busy || maintenance} onClick={() => setModal("storage")}>Data & storage</button>
                <button onClick={() => act(refresh)}>Refresh</button>
                <button onClick={() => setModal("migration")}>
                  Import old data
                </button>
                <button
                  className="primary"
                  disabled={compareIds.length !== 2}
                  onClick={() =>
                    compare(
                      history.find((r) => r.runId === compareIds[0]),
                      history.find((r) => r.runId === compareIds[1]),
                    )
                  }
                >
                  Compare {compareIds.length}/2
                </button>
              </div>
            </div>
            <div className="history-tools">
              <input
                aria-label="Search experiments"
                placeholder="Search name, prompt, model or issue tag…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                aria-label="Filter experiments"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">All results</option>
                <option value="favorites">Favorites</option>
                <option value="issues">Needs improvement</option>
              </select>
            </div>
            <div className="history-grid">
              {runs.map((r) => (
                <article className="panel history-card" key={r.runId}>
                  <button
                    className="history-image"
                    onClick={() => {
                      setDetailRun(r);
                    }}
                  >
                    {r.outputs[0]?.previewUrl ? (
                      <img
                        src={r.outputs[0].previewUrl}
                        alt={r.experimentName}
                      />
                    ) : (
                      <span>No completed image · {r.result}</span>
                    )}
                  </button>
                  <div className="history-info">
                    <h3>
                      {ws.reviews[r.runId]?.favorite ? "★ " : ""}
                      {r.experimentName}
                    </h3>
                    <p>
                      {r.size} · {r.quality} · {cost(r.calculatedChargeUsd)}
                    </p>
                    <small>{date(r.completedAt || r.createdAt)}</small>
                    {ws.reviews[r.runId]?.baseline && (
                      <span className="badge">Baseline</span>
                    )}
                    <div className="actions">
                      <button
                        onClick={() => {
                          setDetailRun(r);
                        }}
                      >
                        Inspect
                      </button>
                      <button className="danger" disabled={busy || maintenance} onClick={() => reviewDeletion(r)}>Delete…</button>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={compareIds.includes(r.runId)}
                          disabled={
                            !r.outputs.length ||
                            (compareIds.length === 2 &&
                              !compareIds.includes(r.runId))
                          }
                          onChange={(e) =>
                            setCompareIds((ids) =>
                              e.target.checked
                                ? [...ids, r.runId]
                                : ids.filter((id) => id !== r.runId),
                            )
                          }
                        />
                        Compare
                      </label>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            {!runs.length && (
              <Empty title="A fresh page for your experiments">
                Your results will appear here.
              </Empty>
            )}
          </main>
        )}
        {detailRun && <ExperimentDetails run={detailRun} api={api} Dialog={Modal} close={() => setDetailRun(null)} reuse={reuseRun} remove={reviewDeletion} disabled={busy || maintenance} />}
        {deletePlan && <DeleteExperiment plan={deletePlan} api={api} Dialog={Modal} close={() => setDeletePlan(null)} completed={deleted} onBusy={setMaintenance} />}
        {modal === "storage" && <StorageDialog api={api} Dialog={Modal} close={() => setModal(null)} changed={storageChanged} onBusy={setMaintenance} disabled={busy} />}
        {modal === "settings" && (
          <Modal title="Next experiment settings" close={() => setModal(null)}>
            <fieldset disabled={busy}>
              <Field label="Model">
                <select
                  value={settings.model}
                  onChange={(e) => setting("model", e.target.value)}
                >
                  {boot.capabilities.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="field-grid">
                <Field label="Size">
                  <input
                    list="sizes"
                    value={settings.size}
                    onChange={(e) => setting("size", e.target.value)}
                  />
                  <datalist id="sizes">
                    {[
                      "1024x1024",
                      "2048x2048",
                      "1536x1024",
                      "1024x1536",
                      "auto",
                    ].map((v) => (
                      <option key={v} value={v} />
                    ))}
                  </datalist>
                </Field>
                {[
                  ["quality", "Quality", boot.capabilities.qualities],
                  ["output_format", "Format", boot.capabilities.outputFormats],
                  ["background", "Background", boot.capabilities.backgrounds],
                ].map(([id, label, values]) => (
                  <Field key={id} label={label}>
                    <select
                      value={settings[id]}
                      onChange={(e) => setting(id, e.target.value)}
                    >
                      {values.map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </Field>
                ))}
                <Field label="Outputs (1–10)">
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={settings.n}
                    onChange={(e) => setting("n", +e.target.value)}
                  />
                </Field>
                <Field label="Compression (JPEG/WebP)">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    disabled={settings.output_format === "png"}
                    value={settings.output_compression}
                    onChange={(e) =>
                      setting("output_compression", +e.target.value)
                    }
                  />
                </Field>
              </div>
              <details>
                <summary>Advanced API controls</summary>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={settings.stream}
                    onChange={(e) => setting("stream", e.target.checked)}
                  />
                  Stream response (displayed after download)
                </label>
                <Field label="Partial images (0–3)">
                  <input
                    type="number"
                    min="0"
                    max="3"
                    disabled={!settings.stream}
                    value={settings.partial_images}
                    onChange={(e) => setting("partial_images", +e.target.value)}
                  />
                </Field>
                <Field label="Input fidelity">
                  <select
                    value={settings.input_fidelity}
                    onChange={(e) => setting("input_fidelity", e.target.value)}
                  >
                    <option value="omit">Do not send</option>
                    <option value="low">Low</option>
                    <option value="high">High</option>
                  </select>
                </Field>
                <p className="muted">
                  Pinned Flare rejected input_fidelity in the earlier
                  evaluation. Use for deliberate capability testing only.
                </p>
                <Field label="End-user identifier">
                  <input
                    value={settings.user}
                    onChange={(e) => setting("user", e.target.value)}
                  />
                </Field>
                <Field label="Request + download timeout (ms)">
                  <input
                    type="number"
                    min="10000"
                    max="600000"
                    value={settings.timeout_ms}
                    onChange={(e) => setting("timeout_ms", +e.target.value)}
                  />
                </Field>
              </details>
              <hr />
              <Field label="Image destination">
                <input readOnly value={outputRoot} />
              </Field>
              <button
                onClick={() =>
                  act(async () => {
                    const p = await api.pickOutputRoot(outputRoot);
                    if (p) setOutputRoot(p);
                  })
                }
              >
                Choose folder
              </button>
              <p className="muted">
                Each run creates an images-only folder. Technical records stay
                in the app profile.
              </p>
            </fieldset>
          </Modal>
        )}
        {modal === "connection" && (
          <Modal title="API connection" close={() => setModal(null)}>
            <p>
              Saved using Windows account encryption in this standalone app’s
              profile.
            </p>
            <Field label="OpenAI API key">
              <input
                type="password"
                autoComplete="new-password"
                value={key}
                disabled={busy || saving}
                onChange={(e) => setKey(e.target.value)}
              />
            </Field>
            <div className="actions">
              <button
                className="primary"
                disabled={!key.trim() || busy || saving}
                onClick={async () => {
                  setSaving(true);
                  await act(async () => {
                    const s = await api.saveApiKey(key);
                    setKey("");
                    setBoot((b) => ({
                      ...b,
                      apiKeyLoaded: s.configured && s.readable,
                    }));
                    setModal(null);
                    setNotice("Connection saved.");
                  });
                  setSaving(false);
                }}
              >
                Save key
              </button>
              <button
                disabled={busy || saving || !boot.apiKeyLoaded}
                onClick={() =>
                  act(async () => {
                    const r = await api.removeApiKey();
                    setBoot((b) => ({
                      ...b,
                      apiKeyLoaded: r.status.configured && r.status.readable,
                    }));
                  })
                }
              >
                Remove saved key
              </button>
            </div>
            <p className="muted">
              No key is imported automatically from the old app.
            </p>
          </Modal>
        )}
        {modal === "pick-prompt" && (
          <Modal title="Choose a prompt" close={() => setModal(null)}>
            <input
              aria-label="Find prompt"
              placeholder="Search prompts…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {ws.prompts
              .filter(
                (p) =>
                  !p.deletedAt &&
                  `${p.title} ${p.tags.join(" ")}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
              )
              .map((p) => (
                <div className="picker-row" key={p.id}>
                  <div>
                    <strong>
                      {p.favorite ? "★ " : ""}
                      {p.title}
                    </strong>
                    <small>{p.notes || p.tags.join(" · ")}</small>
                  </div>
                  <button disabled={busy} onClick={() => loadPrompt(p)}>
                    Load text
                  </button>
                  {p.settings && (
                    <button disabled={busy} onClick={() => loadPrompt(p, true)}>
                      ＋ Settings
                    </button>
                  )}
                </div>
              ))}
            <button
              onClick={() => {
                setModal(null);
                navigate("library");
              }}
            >
              Open full library →
            </button>
          </Modal>
        )}
        {modal === "save-case" && (
          <Modal title="Save test case" close={() => setModal(null)}>
            <p className="muted">
              Stores ordered file references and hashes. Files are verified when
              reopened.
            </p>
            {[
              ["title", "Name"],
              ["tags", "Tags (side profile, low light…)"],
              ["notes", "Expected behavior / observations"],
            ].map(([id, label]) => (
              <Field key={id} label={label}>
                <input
                  value={caseDraft[id]}
                  onChange={(e) =>
                    setCaseDraft((v) => ({
                      ...v,
                      [id]: e.target.value,
                    }))
                  }
                />
              </Field>
            ))}
            <button
              className="primary"
              onClick={() =>
                act(async () => {
                  const s = await api.saveCase({
                    ...caseDraft,
                    images,
                    mask,
                  });
                  setWorkspace(s);
                  setExperimentContext((c) => ({
                    ...c,
                    caseId: s.cases[0].id,
                  }));
                  setModal(null);
                  setNotice("Test case saved.");
                })
              }
            >
              Save case
            </button>
          </Modal>
        )}
        {modal === "cases" && (
          <Modal title="Test cases" close={() => setModal(null)}>
            {ws.cases.length ? (
              ws.cases.map((c) => (
                <div className="picker-row" key={c.id}>
                  <div>
                    <strong>{c.title}</strong>
                    <small>
                      {c.tags.join(" · ")} · {c.images.length} inputs
                    </small>
                    <p>{c.notes}</p>
                  </div>
                  <button
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        await loadInputs(c.images, c.mask);
                        setName(c.title);
                        setExperimentContext((v) => ({
                          ...v,
                          caseId: c.id,
                        }));
                        setModal(null);
                        setNotice("Test case loaded; source hashes verified.");
                      })
                    }
                  >
                    Load case
                  </button>
                </div>
              ))
            ) : (
              <p>Add input images, then choose Save case.</p>
            )}
          </Modal>
        )}
        {modal === "run-details" && (
          <Modal title="Saved run details" close={() => setModal(null)} wide>
            <p>{run.runId}</p>
            <p>
              Request ID: {run.providerRequestId || "Not reported"} · Transport
              calls: {run.transportCalls ?? "Not reported"}
            </p>
            <p className="muted">
              Cost uses the app’s recorded rates, not an invoice. Timing
              includes transfer and decoding.
            </p>
            <div className="text-compare">
              <section>
                <h3>Prompt used</h3>
                <pre>{run.prompt}</pre>
              </section>
              <section>
                <h3>Parameters used</h3>
                <pre>{JSON.stringify(run.settings, null, 2)}</pre>
                <h3>Changes in next experiment</h3>
                <pre>
                  {Object.keys(settings)
                    .filter((k) => settings[k] !== run.settings?.[k])
                    .map(
                      (k) =>
                        `${k}: ${run.settings?.[k] ?? "—"} → ${settings[k]}`,
                    )
                    .join("\n") || "No parameter changes"}
                </pre>
                <p>
                  {prompt === run.prompt
                    ? "Prompt text unchanged."
                    : "Prompt text differs from this run."}
                </p>
              </section>
            </div>
          </Modal>
        )}
        {modal === "migration" && (
          <Modal title="Bring your previous work" close={() => setModal(null)}>
            <h3>Prompt library</h3>
            <p>
              Import an exported experiment JSON from the old app, a preset
              array, or a library export. Imports create new entries.
            </p>
            <button onClick={importLibrary}>Import prompts</button>
            <h3>Experiment history</h3>
            <p>
              Select the old <code>prompt-lab-run-records</code> folder inside
              its Windows application-data directory. Only run records are
              copied; images stay in their original folders.
            </p>
            <button
              onClick={() =>
                act(async () => {
                  const r = await api.importHistory();
                  if (r) {
                    await refresh();
                    setNotice(
                      `Imported ${r.imported} records; skipped ${r.skipped}.`,
                    );
                    setModal(null);
                  }
                })
              }
            >
              Import old run records
            </button>
            <p className="muted">
              Old presets can be exported individually using the previous app’s
              Export button. Keys and browser profiles are not imported. The old
              app stays intact.
            </p>
          </Modal>
        )}
        {viewer && (
          <ImageViewer image={viewer} onClose={() => setViewer(null)} />
        )}
        {comparison && (
          <Compare {...comparison} close={() => setComparison(null)} />
        )}
      </div>
    </FeedbackContext.Provider>
  );
}
