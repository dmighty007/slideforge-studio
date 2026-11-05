---
title: Imports and exports
description: Understand editable content, scientific-object fallbacks and the boundaries between SlideForge, PowerPoint, Keynote, PDF and web exports.
---

<p class="sf-kicker">Guide / portability</p>

# Bring a deck in. Choose how it goes out.

<p class="sf-page-lead">Importing a file, editing its objects, and exporting it again are different capabilities. Keep the native SlideForge deck and review the output your audience will use.</p>

## Import an existing presentation

Open a PowerPoint **.pptx**, Keynote **.key**, or saved SlideForge presentation from the app's open/import workflow.

Supported content can include text, shapes, pictures, tables, charts, notes and media. SlideForge also handles supported builds and transitions. Complex source files may still require adjustments.

Use this review sequence:

1. **Page size and layout:** compare the proportions, object positions and cropping.
2. **Fonts and equations:** check line breaks, glyphs and substitutions or picture fallbacks.
3. **Charts and tables:** inspect values, series, labels and cell structure.
4. **Media and motion:** test sounds, videos, builds and transitions in presentation mode.

### Present a PDF

Choose **PDF** under Import on the start screen (or **Open PDF as Slides** in the command palette) to present a PDF as it is: a Beamer talk, or a deck you received as PDF. Each page becomes a slide whose background is a sharp picture of that page, on the page setup closest to its proportions.

- Links in the PDF stay clickable while presenting: to a web page, or to another page of the PDF.
- Presenter view, speaker notes, the laser pointer, the chalkboard and the timer work as on any slide, and you can add objects or builds over a page.
- The page's text is part of the picture: it cannot be edited or searched in SlideForge.
- Beamer overlays (`\pause`, `\only`) are separate PDF pages, so each step becomes its own slide, as in a PDF viewer.

Import support does not imply pixel-identical conversion. Retain the original deck, especially for complex templates or effects.

!!! note "Keynote import is not Keynote export"
    SlideForge opens supported native Keynote files. It does not currently export native .key files. PowerPoint is the supported editable office-presentation export.

## Choose an output

| Format | Useful for | Editing and interaction |
| --- | --- | --- |
| Native SlideForge | Continuing the scientific work | Keeps supported objects, source inputs, settings and notes |
| PowerPoint (.pptx) | Handing off a familiar office deck | Supported text, shapes, tables and charts remain editable; specialized scientific visuals may become images |
| PDF | Reading, printing and archiving | Static pages with searchable text where supported |
| PNG / SVG | Reusing a slide or figure | A visual export rather than the original scientific object |
| Web (ZIP) | Presenting in a browser, including offline | Supported builds and interactions; some objects use saved stills |

### PowerPoint

Keep the SlideForge version if you will need to change a plugin's input data, a LaTeX expression, a molecular view or another scientific source object. Their exported pictures preserve appearance without carrying equivalent native editing tools into PowerPoint.

Check advanced animation effects and transitions in the receiving application. Unsupported effects may be simplified.

### PDF

Use PDF when the audience needs a readable, fixed version. It does not retain playback, live scientific controls or slide builds.

### Offline web presentation

Choose **Export → Web (ZIP)**, extract the archive, then open its HTML viewer. Keep the exported assets beside the HTML file.

The viewer supports navigation and compatible builds. Molecular views can retain supported interaction. **Landscape Explorer currently uses a saved still in standalone HTML and shared views.**

!!! tip "Offline includes the deck, not the whole internet"
    Exported local assets can travel with the presentation. Remote videos, websites, lookups or other externally hosted content can still require connectivity.

## Share a view-only link

A share link lets others view the supported presentation without editing the source. Availability depends on the app's sharing setup. A public link must be reachable outside your computer; a local-only address is not automatically public.

Review which deck and media are included before sharing. Links that follow saved changes show later edits too. See [sharing a presentation](../DESKTOP.md#sharing-a-presentation).

## Before a real talk

- Open the exact exported file on the destination computer.
- Check fonts, scientific pictures and media.
- Run the click builds and transitions.
- Keep a PDF fallback and the editable native deck.

[Your first presentation](../getting-started.md) · [Presenting and recording](presenting.md)
