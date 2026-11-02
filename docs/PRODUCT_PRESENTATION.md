# Presenting SlideForge

## The pitch

**Scientific figures. Presentation ready.**

SlideForge is a free desktop presentation app for researchers, teachers and students. Build charts, equations
and molecular views directly on your slides, then present or export to PowerPoint and PDF.

Lead with a task people recognize: preparing a lab meeting, explaining a mechanism in a lecture, or turning
results into a conference talk. Show the data becoming a figure and the figure becoming part of the story.
The long tool list belongs after that demonstration.

## README visual sequence

1. **Product in context:** one large editor screenshot with a readable scientific figure and a short headline.
2. **Finished work:** a consistent gallery showing what someone can make.
3. **Distinctive capabilities:** molecular views and diagrams, with short captions explaining their purpose.
4. **Action:** install instructions; detailed development and plugin documentation stay linked separately.

The README uses real existing screenshots. The hero adds a frame and typography; it does not represent a new
capture of the current app. Refresh the underlying screenshots when the interface changes.

## Next screenshot session

Use a demonstration deck with clearly labeled illustrative data, a single research topic and a consistent
theme. Avoid patient information, unpublished results and decks that cannot be redistributed.

| Capture | What it should prove | Composition |
|---|---|---|
| Editor hero | A scientific figure is an editable slide object | Full editor at 1600 × 1000 or larger; readable slide, clean rail, one selected object, relevant properties visible |
| Chart workflow | Data can be changed inside the app | Same chart before and after changing one value; preserve axes and framing |
| Molecular view | A structure can be explored during a talk | Large molecule, contrasting background, minimal labels; use motion for the actual rotation |
| Mechanism | A complex idea can unfold in steps | Three successive build states with the same camera and layout |
| Export | The deck can continue in another workflow | The same slide in SlideForge and the exported file opened in PowerPoint; describe which objects stay editable |

Keep screenshot widths, theme, type scale and margins consistent. Use PNG for UI text. Keep full-size source
captures; compress published images without making labels unreadable. Use a dark navy surround, teal accent
and generous spacing for promotional framing, while preserving the actual app interface. Check at typical
README width as well as full size; a readable slide matters more than showing every toolbar.

Use concise alt text and put explanatory captions outside images. Limit the opening to one hero; put the
four-slide gallery farther down so it can be understood after the pitch.

## A 30-second demonstration

| Time | Action | Message |
|---|---|---|
| 0–5 s | Open a finished scientific slide | “Your next lab meeting starts here.” |
| 5–13 s | Paste chart data and change a value | “Build the figure on the slide.” |
| 13–20 s | Add an equation or rotate a molecule | “Explain the science.” |
| 20–26 s | Present a short diagram build | “Tell the story one step at a time.” |
| 26–30 s | Show export and the install destination | “Take it to PowerPoint. Try SlideForge.” |

Record real interactions. Cut waiting time, keep the pointer deliberate, and use short captions so the demo
works without sound. Link an accessible video and use a short preview in the README once a recording exists.

## Getting the first users

Start with one audience: researchers preparing lab meetings. Make a downloadable example deck and a short
walkthrough for that task. Ask a small group to install the app and produce a real slide; record where they
get stuck and whether their exported deck works for the talk.

Use the finished slides and the data-editing clip in outreach to research groups, teaching communities and
scientific software communities. Tailor each demonstration to the audience. Track installation attempts,
first completed decks, export success and repeat use before broadening the message.

If the aim is revenue, test demand for paid onboarding, training, support or institution-specific work before
choosing a pricing model. Those are product hypotheses, not services currently offered by this repository.
Keep the README clear about what is free and available today.

## Updating the README images

The README's four framed images (`docs/images/readme-hero.webp`, `readme-gallery.webp`, `readme-features.webp`
and `readme-plugins.webp`) are drawn by [tools/render-readme-images.cjs](../tools/render-readme-images.cjs) from
the editor captures beside them (`editor.jpg`, `gallery.jpg`, `molecule.jpg`, `diagram.jpg`, `plugins.jpg`), with
the app's own fonts. Replace a capture, then from the repository root:

```bash
node tools/render-readme-images.cjs                     # all four
node tools/render-readme-images.cjs readme-hero.webp    # or one
```

Look at each image for clipped text and screenshot readability before committing it. Headlines and captions are
in the script; keep their claims true to what the app does.
