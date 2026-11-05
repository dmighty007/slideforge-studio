---
title: Capabilities
description: What SlideForge can build, present and export, with current examples and practical limits.
---

<p class="sf-kicker">Build / explore / explain / deliver</p>

# What you can make in SlideForge

<p class="sf-page-lead">A scientific figure can be an editable object on the slide. Choose the tools that support your explanation, then keep the native deck as the source.</p>

<div class="sf-jump-links"><a href="#data-and-figures">Data &amp; figures</a><a href="#live-scientific-objects">Live objects</a><a href="#diagrams-and-motion">Diagrams &amp; motion</a><a href="#delivery-and-extension">Delivery &amp; extension</a></div>

## Data and figures

<figure class="sf-figure">
<img src="../images/current/curve-fit.webp" alt="Editable dose-response curves drawn from an illustrative table" loading="lazy" width="1280" height="720">
<figcaption>Illustrative data rendered with the Curve Fit plugin. Change the input table or supported model in the editor.</figcaption>
</figure>

| Tool | Start with | Use it for |
| --- | --- | --- |
| Charts and tables | Values from a spreadsheet | Editable series, labels, tables and comparisons |
| Curve fitting | An X column and response columns | Supported dose-response, linear, Michaelis–Menten and decay models |
| LaTeX equations | An expression | A clear mathematical statement beside the figure |
| Statistics plugins | The plugin's specified table | Box/violin plots, survival curves, forest plots, volcano plots and heatmaps |
| Chemistry plugins | SMILES, a feature list or energy levels | Structures, reaction profiles and spectroscopy-style diagrams |
| Biology plugins | Sequences, Newick text or feature lists | Plasmid maps, domains, sequence logos, phylogenetic trees and gels |
| Physics and maths | Equations or short diagram descriptions | Function plots, landscapes, optics, Feynman diagrams and circuits |

These tools help make a figure; they do not replace checking the input, assumptions, units and analysis for your work. The showcase uses example data.

[Browse the plugin reference](PLUGINS.md) or [play the capabilities deck](showcase/capabilities.md).

## Live scientific objects

<div class="sf-showcases">
<figure class="sf-slide"><img src="../images/current/molecule.webp" alt="Ubiquitin shown as a native molecular object" loading="lazy" width="1280" height="720"><figcaption><strong>Molecules and trajectories</strong>Rotate a structure, choose its representation, and play a matching multi-frame trajectory.</figcaption></figure>
<figure class="sf-slide"><img src="../images/current/landscape.webp" alt="A double-well surface with controls for different views" loading="lazy" width="1280" height="720"><figcaption><strong>Landscape Explorer</strong>Switch between heatmaps, contours and 3D surfaces. Inspect values and choose a view.</figcaption></figure>
</div>

- **Molecules:** supported structure files include PDB, CIF/mmCIF, XYZ, GRO, MOL2 and SDF. Binary trajectory attachment supports XTC, TRR, DCD and NetCDF.
- **Trajectory playback:** play/pause, frame stepping, first/last frame, direct frame entry and visible FPS. Save the starting frame, speed and presentation autoplay in the properties panel.
- **Landscapes:** build from an equation or a CSV grid. Use top, front, side and angled 3D views, drag to orbit, pan, zoom, and enable automatic rotation.
- **Presentation behavior:** active native objects own their gestures; the show still exits with Escape. View changes made during a show are temporary.

For binary trajectories, the structure and trajectory must have the same atoms in the same order. Landscape input is a grid; scattered-point interpolation is not included.

[Follow the scientific-object guide →](guides/scientific-objects.md)

## Diagrams and motion

Use connected shapes, Mermaid diagrams, sketches and text to explain a mechanism. Add automatic entrances, click-triggered reveals, emphasis, exits, motion paths and transitions between slides.

Keep speaker notes with each slide. During the show, use presenter view, the timer, laser pointer, spotlight or chalkboard. Supported recording captures the show with a microphone and optional slide audio, then offers a local file.

[Explore the animation deck](showcase/animations.md) or [prepare a talk](guides/presenting.md).

## Delivery and extension

**Bring an existing deck:** import PowerPoint (.pptx) or Keynote (.key), or open a PDF to present its pages as slides. Review complex layouts, fonts, media and builds before presenting.

**Choose an output:** native SlideForge for further editing; PowerPoint for supported editable content; searchable PDF for reading; or an offline web presentation. Specialized scientific objects may export as pictures. Landscape Explorer is live in the native app and a saved still in standalone HTML, PowerPoint and PDF.

**Add a slide-object plugin:** a plugin can define inputs, draw an SVG preview and participate in insertion, saving, properties and exports. Optional live views can provide scientific interaction.

[Import and export details](guides/import-export.md) · [Create a plugin](PLUGINS.md) · [Develop from source](DEVELOPMENT.md)

!!! info "Local work and optional online services"
    Desktop presentations and uploaded assets are stored in the app's local data directory. Core editing does not require an account. Installation, optional font downloads, external lookups, remote embeds, AI providers and public sharing can require a network connection. See [your data](DESKTOP.md#your-data).
