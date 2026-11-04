# Trajectory viewer: playback and frame-loading usability

Validated with the connected_path protein trajectory: protein.pdb (1,545 atoms) and
path_protein.dcd (1,524 frames, approximately 28 MB). The full-system path.dcd has
42,512 atoms and must not be paired with protein.pdb. Source files were read only;
no simulation files are stored in this repository.

## Completed

- First/previous/next/last frame buttons and a one-based frame-number input.
- Frame stepping and scrubbing pause playback.
- Visible FPS beside the speed slider.
- Saved presentation preferences: autoplay, FPS and starting frame.
- Autoplay starts on slide entry, including slides initially hidden in the show;
  playback stops when the slide is hidden or presentation mode ends.
- Playback settings update the viewer without reloading the trajectory.
- One NGL frame request runs at a time. Rapid scrubs coalesce to the latest target;
  rapid next/previous steps retain their accumulated target.
- Frame labels and accessible slider values follow confirmed NGL coordinates.
- Autoplay waits for completion and then a fresh FPS interval; slow frames cannot
  cause an overlapping load or a catch-up burst.
- Pause and slide exit discard queued seeks. A request already handed to NGL may
  finish once; its callback cannot restart paused playback.
- Synchronous frame-load errors stop playback and retain the last confirmed frame.

The properties panel stores presentation defaults. Changes to the live speed
slider are temporary. Existing projects default to manual playback at 10 FPS,
starting at frame 1. Existing continuous looping behavior is retained.

## Validation

Run against a local app with Playwright installed. The default test generates a
small PDB/DCD fixture in a temporary directory and removes it afterward:

```bash
npm run test:molecule-trajectory
```

Run the same checks against the connected_path dataset:

```bash
MOLECULE_TEST_DATASET=/path/to/connected_path npm run test:molecule-trajectory
```

The test serves local files using browser request interception, mounts an isolated
viewer, and does not save or modify a presentation. It checks the real atom/frame
counts, navigation, FPS, presentation autoplay, hidden-slide lifecycle, and control
layout at 380 pixels wide. It waits for confirmed NGL frames and compares sampled
atom coordinates against the processed frame cache, rather than accepting input
labels as evidence of a loaded frame. A controlled delay around the real NGL
setFrame method tests serialization, latest-target seeking, accumulated stepping,
pause/slide exit while loading, absence of catch-up bursts, and load failures.
Set MOLECULE_TEST_SCREENSHOT to a file path to retain a viewer screenshot.
The optional dataset checks are read-only and use no external network requests.

## Next passes

1. Add loop/once/ping-pong playback modes.
2. Import frames.csv for frame time, mechanism segment, and metrics. Use explicit
   per-frame times: this dataset joins simulation segments, so a single inferred
   time step would be misleading.
3. Add reference-frame alignment and selections that persist during playback.
