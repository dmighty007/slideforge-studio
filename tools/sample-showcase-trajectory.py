"""Read a small, explicitly labelled subset of a local DCD into multi-model PDB."""
import struct
import sys
from pathlib import Path

source, destination = Path(sys.argv[1]), Path(sys.argv[2])
template = [line.rstrip("\n") for line in (source / "protein.pdb").open() if line.startswith(("ATOM  ", "HETATM"))]
with (source / "path_protein.dcd").open("rb") as stream:
    def record():
        length_data = stream.read(4)
        if not length_data:
            return None
        length = struct.unpack("<i", length_data)[0]
        body = stream.read(length)
        assert stream.read(4) == length_data, "Invalid DCD record"
        return body
    header = record()
    assert header[:4] == b"CORD"
    frames = struct.unpack_from("<i", header, 4)[0]
    record()
    atoms = struct.unpack("<i", record())[0]
    assert atoms == len(template)
    chosen = {round(index * (frames - 1) / 7) for index in range(8)}
    output, sampled = [], []
    for frame in range(frames):
        x = record()
        if len(x) != atoms * 4: # Optional periodic unit cell.
            x = record()
        y, z = record(), record()
        assert len(x) == len(y) == len(z) == atoms * 4
        if frame not in chosen:
            continue
        coordinates = [struct.unpack("<" + "f" * atoms, values) for values in (x, y, z)]
        output.append(f"MODEL     {len(sampled) + 1:4d}")
        output.append(f"REMARK 900 SOURCE FRAME {frame} OF {frames}; SAMPLED CONFORMATIONS")
        for index, line in enumerate(template):
            values = "".join(f"{axis[index]:8.3f}" for axis in coordinates)
            output.append(line[:30] + values + line[54:])
        output.extend(["TER", "ENDMDL"])
        sampled.append(frame)
output.append("END")
destination.write_text("\n".join(output) + "\n")
print("Sampled frames:", sampled, "atoms:", atoms)
