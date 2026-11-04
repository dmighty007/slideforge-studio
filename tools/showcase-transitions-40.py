"""Retain every slide transition and shared click builds in the generated 40-slide showcase PPTX."""
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

filename = Path(sys.argv[1])
native = json.loads(filename.with_suffix(".json").read_text())
temporary = str(filename) + ".tmp"
namespace = "http://schemas.openxmlformats.org/presentationml/2006/main"
ns = {"p": namespace}
ET.register_namespace("p", namespace)
with zipfile.ZipFile(filename) as source, zipfile.ZipFile(temporary, "w") as target:
    for entry in source.infolist():
        data = source.read(entry.filename)
        match = re.fullmatch(r"ppt/slides/slide(\d+)\.xml", entry.filename)
        if match:
            index = int(match[1]) - 1
            xml = data.decode("utf-8")
            timing = re.search(r"<p:timing\b.*?</p:timing>", xml, re.S)
            # The click builds PowerPoint received: the exporter (bridge/pptx_animations.py) writes entrances and exits
            # only, each on its own click, after any bullet-by-bullet steps. Emphasis, chart and 3D effects are left out.
            def exported(animation):
                def number(value):  # as the exporter reads it: anything that is not a number counts as 1
                    try:
                        return float(value)
                    except (TypeError, ValueError):
                        return 1.0

                start, end = number(animation.get("startOpacity")), number(animation.get("endOpacity"))
                category = str(animation.get("category") or "")
                return start < end or start > end or category in {"entrance", "exit"}

            groups = [
                animation.get("clickGroup")
                for element in native["slides"][index]["elements"]
                for timeline in (element.get("animation") or {}).get("timelines", [])
                for animation in timeline.get("animations", [])
                if animation.get("trigger") == "on-click" and exported(animation)
            ]
            if timing and groups:
                root = ET.fromstring(f'<root xmlns:p="{namespace}">{timing[0]}</root>')[0]
                sequence = root.find('.//p:cTn[@nodeType="mainSeq"]/p:childTnLst', ns)
                steps = [
                    step for step in sequence
                    if step.find('.//p:cTn[@nodeType="clickEffect"]', ns) is not None
                ]
                # Bullet steps come first and stay as they are; the click builds are the steps after them.
                assert len(steps) >= len(groups), f"slide {index + 1}: fewer exported effects than click builds"
                steps = steps[len(steps) - len(groups):]
                if len(steps) == len(set(groups)) and len(steps) != len(groups):
                    groups = list(dict.fromkeys(groups))
                merged = {}
                for step, group in zip(steps, groups, strict=True):
                    sequence.remove(step)
                    if group not in merged:
                        merged[group] = step
                    else:
                        effects = step.find("./p:cTn/p:childTnLst/p:par/p:cTn/p:childTnLst", ns)
                        destination = merged[group].find("./p:cTn/p:childTnLst/p:par/p:cTn/p:childTnLst", ns)
                        for effect in effects:
                            for node in effect.findall('.//p:cTn[@nodeType="clickEffect"]', ns):
                                node.set("nodeType", "withEffect")
                            destination.append(effect)
                for step in merged.values():
                    sequence.append(step)
                xml = xml[:timing.start()] + ET.tostring(root, encoding="unicode") + xml[timing.end():]
            transition_name = native["slides"][index].get("presentationTransition", "fade")
            if "<p:transition" not in xml and transition_name != "none":
                # The nearest PowerPoint transition for each of SlideForge's (importPptx.js reads them back the same way).
                # Convex and concave have only PowerPoint 2010 equivalents: Gallery and Doors, with a Fade for older viewers.
                basic = {"fade": "<p:fade/>", "diffuse": "<p:dissolve/>", "slide": '<p:push dir="l"/>', "zoom": '<p:zoom dir="in"/>'}
                p14 = {"convex": '<p14:gallery dir="l"/>', "concave": '<p14:doors dir="vert"/>'}
                if transition_name in p14:
                    transition = (
                        '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">'
                        '<mc:Choice xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" Requires="p14">'
                        '<p:transition spd="slow" advClick="1" p14:dur="1200">' + p14[transition_name] + "</p:transition></mc:Choice>"
                        '<mc:Fallback><p:transition spd="med" advClick="1"><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>'
                    )
                else:
                    transition = '<p:transition spd="med" advClick="1">' + basic.get(transition_name, "<p:fade/>") + "</p:transition>"
                position = xml.find("<p:timing")
                if position < 0:
                    position = xml.rfind("</p:sld>")
                xml = xml[:position] + transition + xml[position:]
            data = xml.encode("utf-8")
        target.writestr(entry, data)
os.replace(temporary, filename)
