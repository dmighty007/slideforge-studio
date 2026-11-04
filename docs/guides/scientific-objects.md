---
title: Scientific objects
description: Use molecule structures, trajectory playback and Landscape Explorer in the editor and during a talk.
---

<p class="sf-kicker">Guide / scientific objects</p>

# Explore the object while you explain it

<p class="sf-page-lead">Keep a structure, trajectory or mathematical field available for inspection in the native presentation. Save the deck as your editable source.</p>

## Structures and trajectories

Insert a structure with **PDB or Trajectory** in the insert toolbar. Select the molecule to change its style, colour, projection, background or representation layers in **Molecule Viewer**.

<figure class="sf-figure">
<img src="../../images/current/molecule.webp" alt="Ubiquitin, PDB 1UBQ, rendered in the current SlideForge molecular viewer" loading="lazy" width="1280" height="720">
<figcaption>A native molecular view of Ubiquitin, PDB 1UBQ. This is a structure example, not a simulated trajectory.</figcaption>
</figure>

### Attach a binary trajectory

1. Open the structure used for the simulation.
2. Select its molecule object, then choose **Add trajectory** in the properties panel.
3. Attach a supported .xtc, .trr, .dcd or .nc file.
4. Check the frame count and test the first and last frames before the talk.

The structure and every frame must have the **same atoms in the same order**. Pair a protein-only trajectory with its matching protein-only structure; a full-system trajectory containing solvent will not match a protein-only PDB. A rejected trajectory leaves the structure available.

### Control playback

| Control | Behavior |
| --- | --- |
| Play / Pause | Run or hold the trajectory |
| First / Previous / Next / Last | Navigate frames and pause playback |
| Frame slider or frame number | Seek to a frame; displayed numbers are one-based |
| Speed slider | Change live playback rate; FPS is shown beside the slider |
| Properties → Speed (FPS) | Save the presentation's default playback rate |
| Properties → Starting frame | Save the initial frame; values are clamped to the available frames |
| Properties → Play on slide entry | Start automatically when the slide becomes active in presentation mode |

Live speed changes are temporary. Save presentation defaults in the properties panel. Hidden slides stop playback. Keep playback FPS distinct from simulation time; frame sampling and physical time are not necessarily uniform.

### Choose how dragging behaves

In the editor, the molecule's **Orbit / Select** control distinguishes rotating the structure from moving its slide box. In presentation mode the native viewer remains interactive. Use **Reset view** in the properties panel to return to the loaded view.

**Orthographic** projection preserves apparent scale with depth. **Perspective** provides depth-dependent sizing. Neither changes the underlying coordinates.

## Landscape Explorer

Insert **Landscape f(x, y)** from **Plugins → Physics & maths**. Start with an equation such as:

~~~text
(x^2 - 1)^2 + y^2
~~~

Choose **Heatmap**, **Contours**, **Heatmap + contours** or **3D surface**. CSV inputs can be a matrix or grid-aligned x,y,value rows.

<figure class="sf-figure">
<img src="../../images/current/landscape.webp" alt="Landscape Explorer showing a double-well surface and its view controls" loading="lazy" width="1280" height="720">
<figcaption>An illustrative double-well equation in the current 3D viewer. It is not a measured free-energy surface.</figcaption>
</figure>

### Inspect and change the view

Select **Explore** in the editor to use the live plot.

- **Top / Front / Side / 3D:** choose a standard orientation.
- **Drag:** orbit the surface. **Shift-drag** or **right-drag:** pan.
- **Wheel, pinch, or zoom controls:** change magnification.
- **Fit surface to the box:** reset zoom and pan.
- **Play / Pause:** toggle automatic rotation. The speed selector appears while rotating.
- **Crop box to content:** fit the object's slide box around the current drawing.

The renderer uses orthographic projection. Top, front and side buttons change orientation rather than projection type.

Editor view changes save automatically after the interaction. The saved view provides the export still. In presentation mode, the live plot starts on the active slide; camera changes during the show remain temporary. Enable **Auto rotate in presentation** to start motion when the slide appears.

### Know the input limits

Equation sampling is bounded to 9–81 points per axis. CSV grids are limited to 60 KB and 81 coordinates per axis. Missing or undefined values remain gaps. Nonuniform grid coordinates are supported; scattered-point interpolation is not.

[CSV examples, Wigner comparisons and display options →](../PLUGINS.md#landscape-explorer)

## Keep the native source

| Destination | What to expect |
| --- | --- |
| Native SlideForge presentation | Live supported objects and editable inputs |
| PowerPoint / PDF / PNG | Scientific views represented by saved pictures |
| Standalone HTML / shared viewer | Support varies by object; molecules can retain supported interaction, while Landscape Explorer uses its saved still |

[Choose an export format](import-export.md) · [Prepare the talk](presenting.md)
