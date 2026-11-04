"""Retain standard transitions and shared click builds in the generated showcase PPTX."""
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
            groups = [
                animation.get("clickGroup")
                for element in native["slides"][index]["elements"]
                for timeline in (element.get("animation") or {}).get("timelines", [])
                for animation in timeline.get("animations", [])
                if animation.get("trigger") == "on-click"
            ]
            if timing and groups:
                root = ET.fromstring(f'<root xmlns:p="{namespace}">{timing[0]}</root>')[0]
                sequence = root.find('.//p:cTn[@nodeType="mainSeq"]/p:childTnLst', ns)
                steps = [
                    step for step in sequence
                    if step.find('.//p:cTn[@nodeType="clickEffect"]', ns) is not None
                ]
                assert len(steps) in {len(groups), len(set(groups))}, "Exported effects do not match native click builds"
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
            if "<p:transition" not in xml:
                transition_name = native["slides"][index].get("presentationTransition", "fade")
                effect = {"slide": '<p:push dir="l"/>', "zoom": '<p:zoom dir="in"/>'}.get(transition_name, "<p:fade/>")
                transition = '<p:transition spd="med" advClick="1">' + effect + "</p:transition>"
                position = xml.find("<p:timing")
                if position < 0:
                    position = xml.rfind("</p:sld>")
                xml = xml[:position] + transition + xml[position:]
            data = xml.encode("utf-8")
        target.writestr(entry, data)
os.replace(temporary, filename)
