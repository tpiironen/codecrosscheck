# Tasks

- [x] 1. Distinguish "written to disk" from "applied to an unsaved buffer" in
      `ApplyOutcome`, so the word `applied` cannot describe both.
- [x] 2. Render the per-edit report and the summary with that distinction, and
      state plainly that nothing is on disk until the files are saved.
- [x] 3. Offer a save affordance in the summary when a workspace edit host was
      used.
- [x] 4. Record the true status in the `-apply.json` debug log, so a
      post-mortem does not agree with the wrong story.
- [x] 5. Tests: a host-backed apply reports the unsaved status; a
      filesystem-backed apply (CLI, tests) still reports written.
- [x] 6. CHANGELOG.
