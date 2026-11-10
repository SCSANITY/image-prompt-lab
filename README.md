# Image Prompt Lab

<img src="build/icon.png" alt="Image Prompt Lab icon" width="96" />

A local-first Windows desktop workspace for image-edit prompt experiments,
versioning, and visual comparison. Built with Electron, React, and Vite.

Use a repeatable pair of images to refine a prompt, compare results, and keep
the exact inputs and settings behind each experiment. This is an actively
developed tool, not an automatic face-swap quality evaluator.

## What you can do

- **Experiment workspace:** fixed Source and Target inputs, optional mask,
  result viewer, expandable prompt editor, and a separate technical inspector.
- **Prompt library:** named prompts, notes, tags, favorites, immutable versions,
  reversible trash, import/export, and one-click reuse.
- **Repeatable cases:** save ordered input references and hashes; detect missing
  or changed files before reusing a case or sending a request.
- **Visual comparison:** original/result wipe or side-by-side, face-reference
  comparison, and two-run comparison with prompt and parameter differences.
- **Experiment notes:** manual identity, composition, and naturalness assessments,
  favorites, and baseline markers alongside saved run evidence.

## Run locally

This repository publishes **source only**. No prebuilt executable, customer image,
private prompt collection, or generated result is included.

Prerequisites: Windows, Git, and Node.js 22.12+ on the 22 LTS line or Node.js 24+.

```powershell
git clone https://github.com/SCSANITY/image-prompt-lab.git
cd image-prompt-lab
npm ci
.\START_PROMPT_LAB.ps1
```

The development server listens on `127.0.0.1:5178`. Use the Electron window;
opening the browser page alone does not provide the desktop filesystem bridge.

The existing desktop application retains the **YMI Prompt Lab** name and local
profile identity. The public repository name does not relocate existing data.

## One experiment, step by step

1. Add a **Source image**: the artwork or scene to edit. It is always `image1`.
2. Add a **Target image**: the face reference to place into the artwork. It is
   always `image2`, even if you selected it first.
3. Write or load a prompt. Explicitly describe the roles of `image1` and `image2`;
   the app sends your text without adding a hidden prefix.
4. Validate locally, review settings, then confirm one API request when ready.
5. Compare the result, record your assessment, and save the next prompt version.

Both GUI image slots are required for generation. Replacing Source clears its
optional mask; removing one input never promotes the other into its slot.
Saved experiments retain their own prompt/settings even as the next draft changes.

## API and privacy boundaries

**Local-first does not mean offline generation.** Generating an image sends the
selected input images, optional mask, prompt, and parameters to the fixed OpenAI
image-edits endpoint. You supply your own API key and are responsible for API
charges and permission to use the images. No shared key is bundled.

- One in-flight request, native confirmation, and no automatic retry.
- Local validation and the included test suites do not require a paid API call.
- Keys entered through **Connect API** use Electron `safeStorage` with Windows
  account encryption. They are not exported with prompts or run evidence.
- An inherited session-level `OPENAI_API_KEY` fallback is supported; the main
  process reads it and removes it from its environment. Never put a key in source.
- Input hashes are checked again before transmission; source files are not edited.
- Timeout and uncertain outcomes retain evidence rather than silently resending.

The provider model identifiers, accepted parameters, and cost estimates are
inherited experimental configuration. Offline tests do **not** establish current
model access, provider compatibility, pricing, or real face-swap quality. Review
the selected model/settings before making a paid request.

## Where your data lives

| Data | Default location or behavior |
| --- | --- |
| Desktop profile | `%APPDATA%/YMI Prompt Lab Standalone` |
| Prompts, versions, cases, assessments | `workspace.json` in the profile, with a previous-valid backup |
| Run evidence | `prompt-lab-run-records` inside the profile |
| Generated images | Documents `YMI Prompt Lab Images`, or your selected directory |
| Source images | Remain at their original paths; cases save references and hashes |

The standalone profile is shared across development and packaged builds, with a
single-instance lock. Tests use isolated temporary profiles. A deliberate
`--user-data-dir` overrides the profile for isolated testing.

Keep exports, profile backups, screenshots, and image directories private: they
can contain prompts, faces, local paths, and experiment metadata. Do not save them
inside tracked source directories. Moving an original image breaks its saved
reference. Back up the profile and required images together; a prompt-library
export does not contain cases, assessments, keys, or photos.

Legacy JSON/history import is user-driven. It does not automatically copy a
Chromium profile or migrate credentials. Inspect any import before using it.

## Verification and local packaging

```powershell
npm test
npm run build
npm run smoke
```

Unit tests use a network guard and fake provider responses. Electron UI smoke
tests use synthetic images, temporary storage, and a blocked generation handler.
The checks cover storage/versioning, request boundaries, input order, comparisons,
and layout at multiple window sizes. They are not live provider certification.

To build your own unsigned Windows portable application:

```powershell
npm run dist
node tests/packaged-smoke.cjs 'release/win-unpacked/YMI Prompt Lab.exe'
node tests/packaged-smoke.cjs 'release/YMI-Prompt-Lab-0.2.0-portable.exe'
```

Generated `release/`, `dist/`, and dependencies stay outside Git. If a previous
build is locked, close your test application and choose a fresh build output
directory. Do not disable Electron sandboxing or broadly change system permissions
to resolve a local packaging issue.

## Current limitations

- The history view shows the latest 50 records; A/B comparison selects the first
  output of each chosen run. Individual outputs remain inspectable.
- No batch queue, automatic quality scoring, or cancel-and-resubmit automation.
- Streaming data is collected after download, not displayed as a live canvas.
- Cost is an estimate; one attractive result does not establish prompt robustness.
- Windows is the tested platform; no macOS/Linux packaging support is claimed.

## Contributing without publishing private data

Use synthetic fixtures and fake credentials. Never attach real face photos,
private prompts, API keys (including encrypted copies), profile folders, or raw
run records to commits or issues. Review the staged diff and run a secret scanner
before pushing. Git ignore rules are a guardrail, not a content review.

Data JSON, image files, and binary builds are ignored by default; package manifests
and the original application icon are explicit exceptions. New public demo assets
need an intentional, reviewed exception. Do not force-add private files.

## License and attribution

[MIT](LICENSE). Derived from an earlier YMI image-prompt desktop tool, retaining
its attribution. The warm portrait/prompt icon is original vector artwork in
`build/icon.svg`; `node build/make-icon.mjs` regenerates its PNG and Windows ICO.
