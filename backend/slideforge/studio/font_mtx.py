"""Decode MicroType Express (MTX) compressed fonts into plain TrueType.

PowerPoint embeds fonts as EOT files (ppt/fonts/*.fntdata); when the EOT flag TTEMBED_TTCOMPRESSED is set, the
font data is MTX-compressed. This module turns such an MTX payload back into an sfnt that browsers accept.

Implemented from the W3C Member Submission "MicroType Express (MTX) Font Format" (Monotype Imaging, 2008,
https://www.w3.org/Submission/MTX/):

* ch. 2   - the 10-byte header (version 3, copy limit, offsets of data blocks 2 and 3);
* ch. 3   - LZCOMP: three adaptive Huffman trees (symbols, lengths, distances), a preloaded history, the
  single-byte DUP2/4/6 copies and the optional run-length pass (decode paths of the Appendix C sample code);
* ch. 4-5 - the Compact Table Format of block 1: 'loca' rebuilt, 'cvt ' deltas, magnitude-dependent encoding of
  'hdmx' and 'VDMX', and the 'glyf' translation (contour point counts, triplet-encoded coordinates, composites);
* ch. 6-7 - per-glyph push data (255USHORT/255SHORT with Hop3/Hop4 codes) from block 2 and instructions from block 3.

Pure standard library. Malformed input raises :class:`MtxError`; output sizes are capped.
"""

from __future__ import annotations

import struct

__all__ = ["MtxError", "decompress_mtx"]

MAX_OUTPUT = 64 * 1024 * 1024  # cap for any decompressed block and for the final font


class MtxError(ValueError):
    """The data is not a valid MicroType Express font (or is too large to decode safely)."""


# --------------------------------------------------------------------------------------------------------------------
# LZCOMP (spec ch. 3 and Appendix C)
# --------------------------------------------------------------------------------------------------------------------

_BITS = [bytes((b >> s) & 1 for s in range(7, -1, -1)) for b in range(256)]  # MSB-first bit expansion of a byte


def _preload() -> bytes:
    """History preloaded before decoding so that early data can use copy items (InitializeModel)."""
    out = bytearray()
    for k in range(32):
        for j in range(96):
            out.append(k)
            out.append(j)
    for j in range(256):
        out += bytes((j, j, j, j))
    return bytes(out)


_PRELOAD = _preload()  # 2*32*96 + 4*256 bytes
_MAX_2BYTE_DIST = 512


class _AHuff:
    """Adaptive Huffman tree over symbols [0, rng).

    Nodes live in a heap-shaped array (root = 1). ``node[i]`` holds the left-child index of an internal node (its
    right child is always the next index) or ``~symbol`` for a leaf. ``up`` is fixed per position; swapping two nodes
    swaps their contents and re-points children / the symbol index.
    """

    __slots__ = ("node", "up", "weight", "symidx")

    def __init__(self, rng: int):
        n2 = 2 * rng
        self.up = up = [0] * n2
        self.weight = weight = [0] * n2
        self.node = node = [0] * n2
        self.symidx = symidx = [0] * rng
        for i in range(2, n2):
            up[i] = i >> 1
            weight[i] = 1
        for i in range(1, rng):
            node[i] = 2 * i
        for i in range(rng):
            node[rng + i] = ~i
            symidx[i] = rng + i
        for i in range(rng - 1, 0, -1):
            weight[i] = weight[2 * i] + weight[2 * i + 1]
        weight[0] = -1  # sentinel: never equal to a real weight
        if 256 < rng < 512:
            self.update(symidx[256])
            self.update(symidx[257])
            for _ in range(12):  # DUP2
                self.update(symidx[rng - 3])
            for _ in range(6):  # DUP4
                self.update(symidx[rng - 2])
        else:
            for _ in range(2):
                for i in range(rng):
                    self.update(symidx[i])

    def update(self, a: int) -> None:
        node, up, weight, symidx = self.node, self.up, self.weight, self.symidx
        while a != 1:
            w = weight[a]
            if weight[a - 1] == w:
                b = a - 1
                while weight[b - 1] == w:
                    b -= 1
                if b > 1:
                    na = node[a]
                    nb = node[b]
                    node[a] = nb
                    node[b] = na
                    if nb >= 0:
                        up[nb] = a
                        up[nb + 1] = a
                    else:
                        symidx[~nb] = a
                    if na >= 0:
                        up[na] = b
                        up[na + 1] = b
                    else:
                        symidx[~na] = b
                    a = b
            weight[a] = w + 1
            a = up[a]
        weight[1] += 1


def _make_reader(tree: _AHuff, bits: bytes):
    """Return read(p) -> (symbol, new_p) for ``tree`` over the 0/1 byte string ``bits``."""
    node, up, weight, symidx = tree.node, tree.up, tree.weight, tree.symidx

    def read(p: int):
        a = 1
        while True:
            a = node[a] + bits[p]
            p += 1
            sym = node[a]
            if sym < 0:
                break
        # UpdateWeight (inlined)
        while a != 1:
            w = weight[a]
            if weight[a - 1] == w:
                b = a - 1
                while weight[b - 1] == w:
                    b -= 1
                if b > 1:
                    na = node[a]
                    nb = node[b]
                    node[a] = nb
                    node[b] = na
                    if nb >= 0:
                        up[nb] = a
                        up[nb + 1] = a
                    else:
                        symidx[~nb] = a
                    if na >= 0:
                        up[na] = b
                        up[na + 1] = b
                    else:
                        symidx[~na] = b
                    a = b
            weight[a] = w + 1
            a = up[a]
        weight[1] += 1
        return ~sym, p

    return read


def _lzcomp_decode(block: bytes) -> bytes:
    """Decompress one LZCOMP block (MTX version 3: leading run-length flag bit)."""
    if len(block) < 4:
        raise MtxError("LZCOMP block too short")
    bits = b"".join([_BITS[b] for b in block])
    using_rl = bits[0]
    out_len = 0
    for i in range(1, 25):
        out_len = (out_len << 1) | bits[i]
    p = 25
    # SetDistRange
    ndr = 1
    while (1 << (3 * ndr)) < out_len:
        ndr += 1
    dup2 = 256 + 8 * ndr
    dup4 = dup2 + 1
    dup6 = dup2 + 2
    num_syms = dup2 + 3

    dist_read = _make_reader(_AHuff(8), bits)
    len_read = _make_reader(_AHuff(8), bits)
    sym_tree = _AHuff(num_syms)
    node, up, weight, symidx = sym_tree.node, sym_tree.up, sym_tree.weight, sym_tree.symidx

    buf = bytearray(_PRELOAD)
    n = len(buf)
    target = n + out_len
    append = buf.append
    try:
        while n < target:  # running past the end of ``bits`` raises IndexError
            # --- read one symbol from the symbol tree (inlined MTX_AHUFF_ReadSymbol + UpdateWeight) ---
            a = 1
            while True:
                a = node[a] + bits[p]
                p += 1
                sym = node[a]
                if sym < 0:
                    break
            sym = ~sym
            while a != 1:
                w = weight[a]
                if weight[a - 1] == w:
                    b = a - 1
                    while weight[b - 1] == w:
                        b -= 1
                    if b > 1:
                        na = node[a]
                        nb = node[b]
                        node[a] = nb
                        node[b] = na
                        if nb >= 0:
                            up[nb] = a
                            up[nb + 1] = a
                        else:
                            symidx[~nb] = a
                        if na >= 0:
                            up[na] = b
                            up[na + 1] = b
                        else:
                            symidx[~na] = b
                        a = b
                weight[a] = w + 1
                a = up[a]
            weight[1] += 1
            # --- interpret ---
            if sym < 256:
                append(sym)
                n += 1
            elif sym == dup2:
                append(buf[-2])
                n += 1
            elif sym == dup4:
                append(buf[-4])
                n += 1
            elif sym == dup6:
                append(buf[-6])
                n += 1
            else:
                v = sym - 256
                nranges = (v >> 3) + 1
                v &= 7
                length = v & 3
                while v & 4:  # bit 2 set: more 3-bit length symbols follow (DecodeLength: done when clear)
                    v, p = len_read(p)
                    length = (length << 2) | (v & 3)
                    if length > out_len:
                        raise MtxError("LZCOMP copy length out of range")
                length += 2
                dist = 0
                for _ in range(nranges):
                    v, p = dist_read(p)
                    dist = (dist << 3) | v
                dist += 1
                if dist >= _MAX_2BYTE_DIST:
                    length += 1
                end = n - dist + 1
                start = end - length
                if start < 0:
                    raise MtxError("LZCOMP copy reaches before the start of the data")
                buf += buf[start:end]
                n += length
    except IndexError:
        raise MtxError("LZCOMP data truncated") from None
    if len(buf) != target:
        raise MtxError("LZCOMP output length mismatch")
    out = bytes(buf[len(_PRELOAD):])
    if using_rl:
        out = _runlength_decode(out)
    return out


def _runlength_decode(data: bytes) -> bytes:
    """Undo MTX run-length coding: byte 0 is the escape; ESC 0 = literal ESC, ESC n b = b repeated n times."""
    if not data:
        return data
    esc = data[0]
    n = len(data)
    parts = []
    total = 0
    i = 1
    find = data.find
    while True:
        j = find(esc, i)
        if j < 0:
            parts.append(data[i:])
            break
        parts.append(data[i:j])
        if j + 1 >= n:
            raise MtxError("run-length data truncated")
        count = data[j + 1]
        if count == 0:
            parts.append(bytes((esc,)))
            i = j + 2
        else:
            if j + 2 >= n:
                raise MtxError("run-length data truncated")
            parts.append(bytes((data[j + 2],)) * count)
            i = j + 3
            total += count
            if total > MAX_OUTPUT:
                raise MtxError("decompressed data too large")
    out = b"".join(parts)
    if len(out) > MAX_OUTPUT:
        raise MtxError("decompressed data too large")
    return out


# --------------------------------------------------------------------------------------------------------------------
# Compact Table Format helpers
# --------------------------------------------------------------------------------------------------------------------

_U16 = struct.Struct(">H")
_S16 = struct.Struct(">h")
_U32 = struct.Struct(">I")


def _read_255ushort(d: bytes, p: int):
    code = d[p]
    p += 1
    if code == 253:
        return (d[p] << 8) | d[p + 1], p + 2
    if code == 255:
        return 253 + d[p], p + 1
    if code == 254:
        return 506 + d[p], p + 1
    return code, p


def _read_255short(d: bytes, p: int):
    code = d[p]
    p += 1
    if code == 253:
        v = (d[p] << 8) | d[p + 1]
        return (v - 0x10000 if v & 0x8000 else v), p + 2
    sign = 1
    if code == 250:
        sign = -1
        code = d[p]
        p += 1
    if code == 255:
        v = 250 + d[p]
        p += 1
    elif code == 254:
        v = 500 + d[p]
        p += 1
    elif code >= 250:
        raise MtxError("invalid 255SHORT code")
    else:
        v = code
    return sign * v, p


def _read_push_data(d: bytes, p: int, count: int):
    """Decode ``count`` push values (255SHORT with Hop3/Hop4 codes, spec 6.2)."""
    vals = []
    append = vals.append
    rd = _read_255short
    while len(vals) < count:
        code = d[p]
        if code == 251 or code == 252:  # Hop3Code / Hop4Code
            if len(vals) < 2:
                raise MtxError("hop code without history")
            a = vals[-2]
            p += 1
            append(a)
            x, p = rd(d, p)
            append(x)
            append(a)
            if code == 252:
                x, p = rd(d, p)
                append(x)
                append(a)
        else:
            x, p = rd(d, p)
            append(x)
    if len(vals) != count:
        raise MtxError("push data overruns its count")
    return vals, p


def _push_instructions(vals) -> bytes:
    """Encode values as TrueType PUSHB/PUSHW/NPUSHB/NPUSHW instructions."""
    out = bytearray()
    n = len(vals)
    i = 0
    while i < n:
        is_byte = 0 <= vals[i] <= 255
        j = i + 1
        while j < n and j - i < 255 and (0 <= vals[j] <= 255) == is_byte:
            j += 1
        cnt = j - i
        if is_byte:
            if cnt <= 8:
                out.append(0xB0 + cnt - 1)
            else:
                out += bytes((0x40, cnt))
            out += bytes(vals[i:j])
        else:
            if cnt <= 8:
                out.append(0xB8 + cnt - 1)
            else:
                out += bytes((0x41, cnt))
            for v in vals[i:j]:
                if not -32768 <= v <= 32767:
                    raise MtxError("push value out of range")
                out += _S16.pack(v)
        i = j
    return bytes(out)


class _Instr:
    """Cursor over data blocks 2 (push data) and 3 (instructions)."""

    __slots__ = ("push", "pp", "code", "cp")

    def __init__(self, push: bytes, code: bytes):
        self.push = push
        self.pp = 0
        self.code = code
        self.cp = 0

    def take(self, push_count: int, code_size: int) -> bytes:
        vals, self.pp = _read_push_data(self.push, self.pp, push_count)
        if self.pp > len(self.push):
            raise MtxError("push data block truncated")
        cp = self.cp
        if cp + code_size > len(self.code):
            raise MtxError("instruction block truncated")
        self.cp = cp + code_size
        return _push_instructions(vals) + self.code[cp:cp + code_size]


def _decode_simple(g: bytes, p: int, nc: int, bbox, instr: _Instr):
    """Decode one simple CTF glyph starting after its header. Returns (ttf_glyph_bytes, new_p)."""
    end_pts = []
    total = -1
    rd = _read_255ushort
    for k in range(nc):
        v, p = rd(g, p)
        total += v if k else v + 1
        end_pts.append(total)
    npts = total + 1
    if npts < 0 or npts > 0xFFFF:
        raise MtxError("bad glyph point count")
    if len(end_pts) > 1:
        for k in range(1, nc):
            if end_pts[k] < end_pts[k - 1]:
                raise MtxError("bad contour end points")
    flags = g[p:p + npts]
    if len(flags) != npts:
        raise MtxError("glyph flags truncated")
    p += npts

    xs = bytearray()
    ys = bytearray()
    tflags = bytearray()
    x = y = 0
    xmin = ymin = 32767
    xmax = ymax = -32768
    for f in flags:
        t = f & 0x7F
        if t < 10:
            dx = 0
            dy = ((t & 14) << 7) + g[p]
            p += 1
            if not t & 1:
                dy = -dy
        elif t < 20:
            dx = (((t - 10) & 14) << 7) + g[p]
            dy = 0
            p += 1
            if not t & 1:
                dx = -dx
        else:
            if t < 84:
                b0 = t - 20
                b1 = g[p]
                p += 1
                dx = 1 + (b0 & 0x30) + (b1 >> 4)
                dy = 1 + ((b0 & 0x0C) << 2) + (b1 & 0x0F)
            elif t < 120:
                b0 = t - 84
                dx = 1 + ((b0 // 12) << 8) + g[p]
                dy = 1 + (((b0 % 12) >> 2) << 8) + g[p + 1]
                p += 2
            elif t < 124:
                b1 = g[p + 1]
                dx = (g[p] << 4) + (b1 >> 4)
                dy = ((b1 & 0x0F) << 8) + g[p + 2]
                p += 3
            else:
                dx = (g[p] << 8) + g[p + 1]
                dy = (g[p + 2] << 8) + g[p + 3]
                p += 4
            if not t & 1:
                dx = -dx
            if not t & 2:
                dy = -dy
        x += dx
        y += dy
        if x < xmin:
            xmin = x
        if x > xmax:
            xmax = x
        if y < ymin:
            ymin = y
        if y > ymax:
            ymax = y
        tf = 0 if f & 0x80 else 1  # ON_CURVE_POINT
        if dx == 0:
            tf |= 0x10
        elif -255 <= dx <= 255:
            if dx > 0:
                tf |= 0x12
                xs.append(dx)
            else:
                tf |= 0x02
                xs.append(-dx)
        else:
            if not -32768 <= dx <= 32767:
                raise MtxError("glyph coordinate out of range")
            xs += _S16.pack(dx)
        if dy == 0:
            tf |= 0x20
        elif -255 <= dy <= 255:
            if dy > 0:
                tf |= 0x24
                ys.append(dy)
            else:
                tf |= 0x04
                ys.append(-dy)
        else:
            if not -32768 <= dy <= 32767:
                raise MtxError("glyph coordinate out of range")
            ys += _S16.pack(dy)
        tflags.append(tf)
    if p > len(g):
        raise MtxError("glyph coordinates truncated")
    if npts and not (-32768 <= xmin and xmax <= 32767 and -32768 <= ymin and ymax <= 32767):
        raise MtxError("glyph coordinate out of range")

    push_count, p = rd(g, p)
    code_size, p = rd(g, p)
    instructions = instr.take(push_count, code_size)
    if len(instructions) > 0xFFFF:
        raise MtxError("glyph instructions too long")

    if bbox is None:
        bbox = (xmin, ymin, xmax, ymax) if npts else (0, 0, 0, 0)

    # TrueType flag run-length compression
    packed = bytearray()
    i = 0
    n = len(tflags)
    while i < n:
        f = tflags[i]
        j = i + 1
        while j < n and tflags[j] == f and j - i <= 255:
            j += 1
        rep = j - i - 1
        if rep >= 2:
            packed.append(f | 0x08)
            packed.append(rep)
        else:
            packed.extend(tflags[i:j])
        i = j

    out = bytearray(struct.pack(">hhhhh", nc, *bbox))
    for e in end_pts:
        out += _U16.pack(e)
    out += _U16.pack(len(instructions))
    out += instructions
    out += packed
    out += xs
    out += ys
    return bytes(out), p


def _decode_composite(g: bytes, p: int, instr: _Instr):
    start = p - 2
    p += 8  # bounding box (always stored for composites)
    have_instr = False
    while True:
        if p + 4 > len(g):
            raise MtxError("composite glyph truncated")
        flags = (g[p] << 8) | g[p + 1]
        size = 4 + (4 if flags & 0x0001 else 2)
        if flags & 0x0008:
            size += 2
        elif flags & 0x0040:
            size += 4
        elif flags & 0x0080:
            size += 8
        p += size
        if flags & 0x0100:
            have_instr = True
        if not flags & 0x0020:
            break
    if p > len(g):
        raise MtxError("composite glyph truncated")
    out = g[start:p]
    if have_instr:
        push_count, p = _read_255ushort(g, p)
        code_size, p = _read_255ushort(g, p)
        instructions = instr.take(push_count, code_size)
        if len(instructions) > 0xFFFF:
            raise MtxError("glyph instructions too long")
        out += _U16.pack(len(instructions)) + instructions
    return out, p


def _decode_glyf(g: bytes, num_glyphs: int, instr: _Instr):
    glyphs = []
    p = 0
    n = len(g)
    s16 = _S16.unpack_from
    for _ in range(num_glyphs):
        if p + 2 > n:
            raise MtxError("glyf table truncated")
        nc = s16(g, p)[0]
        p += 2
        if nc == 0:
            glyphs.append(b"")
        elif nc == -1:
            out, p = _decode_composite(g, p, instr)
            glyphs.append(out)
        elif nc > 0:
            bbox = None
            if nc == 0x7FFF:
                if p + 10 > n:
                    raise MtxError("glyf table truncated")
                nc, *bb = struct.unpack_from(">hhhhh", g, p)
                p += 10
                bbox = tuple(bb)
                if nc < 0:
                    raise MtxError("bad contour count")
                if nc == 0:  # explicit empty outline with a bounding box
                    out, p = _decode_simple(g, p, 0, bbox, instr)
                    glyphs.append(out)
                    continue
            out, p = _decode_simple(g, p, nc, bbox, instr)
            glyphs.append(out)
        else:
            raise MtxError("bad contour count")
        if p > n:
            raise MtxError("glyf table truncated")
    return glyphs, p


def _decode_cvt(d: bytes) -> bytes:
    if len(d) < 2:
        raise MtxError("cvt table truncated")
    count = _U16.unpack_from(d, 0)[0]
    p = 2
    out = bytearray()
    last = 0
    for _ in range(count):
        code = d[p]
        p += 1
        if code < 238:
            v = code
        elif code >= 248:
            v = d[p] + (code - 247) * 238
            p += 1
        elif code >= 239:
            v = -(d[p] + (code - 239) * 238)
            p += 1
        else:  # 238: word follows
            v = _S16.unpack_from(d, p)[0]
            p += 2
        last = (last + v) & 0xFFFF
        out += _U16.pack(last)
    if p > len(d):
        raise MtxError("cvt table truncated")
    return bytes(out)


class _MagReader:
    """Magnitude dependent encoded values, bits read LSB first within each byte (spec 5.3)."""

    __slots__ = ("d", "bit")

    def __init__(self, d: bytes, byte_pos: int):
        self.d = d
        self.bit = byte_pos * 8

    def _b(self) -> int:
        bit = self.bit
        self.bit = bit + 1
        return (self.d[bit >> 3] >> (bit & 7)) & 1

    def value(self) -> int:
        n = 0
        while self._b():
            n += 1
            if n > 0xFFFF:
                raise MtxError("bad magnitude value")
        if n and self._b():
            return -n
        return n

    def byte_pos(self) -> int:
        return (self.bit + 7) >> 3


def _decode_hdmx(d: bytes, num_glyphs: int, upem: int, advances) -> bytes:
    version, num_records, record_size = struct.unpack_from(">HhI", d, 0)
    if version > 0x7FFF:  # stored uncompressed, version = 0xFFFF - real version
        return _U16.pack(0xFFFF - version) + d[2:]
    if num_records < 0 or record_size < num_glyphs + 2 or upem <= 0:
        raise MtxError("bad hdmx header")
    if num_records * record_size > MAX_OUTPUT or num_records * num_glyphs > 8 * len(d):
        raise MtxError("hdmx too large")  # every encoded width takes at least one bit
    ppems = [(d[8 + 2 * i], d[9 + 2 * i]) for i in range(num_records)]
    rd = _MagReader(d, 8 + 2 * num_records)
    out = bytearray(d[0:8])
    for ppem, max_width in ppems:
        rec = bytearray((ppem, max_width))
        for gid in range(num_glyphs):
            pred = ((64 * ppem * advances[gid] + upem // 2) // upem + 32) // 64
            rec.append((pred + rd.value()) & 0xFF)
        rec += bytes(record_size - len(rec))
        out += rec
    return bytes(out)


def _decode_vdmx(d: bytes) -> bytes:
    version, num_recs, num_ratios = struct.unpack_from(">HHH", d, 0)
    if version > 0x7FFF:
        return _U16.pack(0xFFFF - version) + d[2:]
    hdr_end = 6 + 4 * num_ratios
    offsets = list(struct.unpack_from(">%dH" % num_ratios, d, hdr_end))
    if not num_ratios or not num_recs:
        return d
    p = offsets[0]
    groups = []
    for _ in range(num_recs):
        recs, ymax_mult, ymin_mult = struct.unpack_from(">Hhh", d, p)
        if 3 * recs > 8 * (len(d) - p - 6):
            raise MtxError("VDMX group truncated")
        rd = _MagReader(d, p + 6)
        predicted_ppem = 8
        entries = []
        for _ in range(recs):
            ppem = rd.value() + predicted_ppem
            ymax = (ppem * ymax_mult + 1024) // 2048 + rd.value()
            ymin = -((ppem * ymin_mult + 1024) // 2048) + rd.value()
            entries.append((ppem, ymax, ymin))
            predicted_ppem = ppem + 1
        p = rd.byte_pos()
        groups.append(entries)
    out = bytearray(d[0:hdr_end])
    group_offsets = []
    pos = hdr_end + 2 * num_ratios
    for entries in groups:
        group_offsets.append(pos)
        pos += 4 + 6 * len(entries)
    if sorted(offsets) != offsets or any(o not in group_offsets for o in offsets):
        offsets = [group_offsets[min(i, len(groups) - 1)] for i in range(num_ratios)]
    for o in offsets:
        out += _U16.pack(o)
    for entries in groups:
        if entries:
            start, end = entries[0][0], entries[-1][0]
        else:
            start = end = 0
        out += struct.pack(">HBB", len(entries), start & 0xFF, end & 0xFF)
        for ppem, ymax, ymin in entries:
            out += struct.pack(">Hhh", ppem & 0xFFFF, max(-32768, min(32767, ymax)), max(-32768, min(32767, ymin)))
    return bytes(out)


# --------------------------------------------------------------------------------------------------------------------
# sfnt assembly
# --------------------------------------------------------------------------------------------------------------------


def _checksum(data: bytes) -> int:
    pad = (-len(data)) & 3
    if pad:
        data = data + b"\0" * pad
    return sum(struct.unpack(">%dI" % (len(data) // 4), data)) & 0xFFFFFFFF


def _build_sfnt(version: int, tables: dict) -> bytes:
    tags = sorted(tables)
    num = len(tags)
    entry_selector = max(num.bit_length() - 1, 0)
    search_range = (1 << entry_selector) * 16
    header = bytearray(struct.pack(">IHHHH", version, num, search_range, entry_selector, num * 16 - search_range))
    offset = 12 + 16 * num
    body = bytearray()
    head_offset = None
    for tag in tags:
        data = tables[tag]
        if tag == b"head":
            head_offset = offset + len(body)
        header += struct.pack(">4sIII", tag, _checksum(data), offset + len(body), len(data))
        body += data
        body += b"\0" * ((-len(data)) & 3)
    font = header + body
    if head_offset is not None:
        adj = (0xB1B0AFBA - _checksum(bytes(font))) & 0xFFFFFFFF
        font[head_offset + 8:head_offset + 12] = _U32.pack(adj)
    if len(font) > MAX_OUTPUT:
        raise MtxError("decoded font too large")
    return bytes(font)


def _ctf_to_sfnt(ctf: bytes, push: bytes, code: bytes) -> bytes:
    if len(ctf) < 12:
        raise MtxError("font directory truncated")
    version, num_tables = struct.unpack_from(">IH", ctf, 0)
    if 12 + 16 * num_tables > len(ctf):
        raise MtxError("font directory truncated")
    tables = {}
    for i in range(num_tables):
        tag, _cs, off, length = struct.unpack_from(">4sIII", ctf, 12 + 16 * i)
        if tag == b"loca":
            continue
        if off + length > len(ctf):
            raise MtxError("table %r out of bounds" % tag)
        tables[tag] = ctf[off:off + length]

    head = tables.get(b"head")
    maxp = tables.get(b"maxp")
    if head is None or maxp is None or len(head) < 54 or len(maxp) < 6:
        raise MtxError("missing or short head/maxp table")
    head = bytearray(head)
    head[8:12] = b"\0\0\0\0"
    num_glyphs = _U16.unpack_from(maxp, 4)[0]
    upem = _U16.unpack_from(head, 18)[0]

    if b"glyf" in tables:
        glyphs, _ = _decode_glyf(tables[b"glyf"], num_glyphs, _Instr(push, code))
        loca_fmt = _S16.unpack_from(head, 50)[0]
        glyf = bytearray()
        offsets = []
        for gdata in glyphs:
            offsets.append(len(glyf))
            glyf += gdata
            if len(glyf) & 3:
                glyf += b"\0" * ((-len(glyf)) & 3)
            if len(glyf) > MAX_OUTPUT:
                raise MtxError("decoded glyf too large")
        offsets.append(len(glyf))
        if loca_fmt == 0 and len(glyf) > 0x1FFFE:
            loca_fmt = 1
        if loca_fmt == 0:
            loca = struct.pack(">%dH" % len(offsets), *[o >> 1 for o in offsets])
        else:
            loca_fmt = 1
            loca = struct.pack(">%dI" % len(offsets), *offsets)
        head[50:52] = _S16.pack(loca_fmt)
        tables[b"glyf"] = bytes(glyf)
        tables[b"loca"] = loca

    if b"cvt " in tables:
        tables[b"cvt "] = _decode_cvt(tables[b"cvt "])

    if b"hdmx" in tables:
        try:
            hhea = tables[b"hhea"]
            hmtx = tables[b"hmtx"]
            n_hm = _U16.unpack_from(hhea, 34)[0]
            if not 0 < n_hm <= num_glyphs or len(hmtx) < 4 * n_hm:
                raise MtxError("bad hmtx")
            adv = list(struct.unpack_from(">%dH" % (2 * n_hm), hmtx, 0)[0::2])
            adv += [adv[-1]] * (num_glyphs - n_hm)
            tables[b"hdmx"] = _decode_hdmx(tables[b"hdmx"], num_glyphs, upem, adv)
        except (MtxError, KeyError, IndexError, struct.error):
            del tables[b"hdmx"]  # optional device metrics: drop rather than fail

    if b"VDMX" in tables:
        try:
            tables[b"VDMX"] = _decode_vdmx(tables[b"VDMX"])
        except (MtxError, IndexError, struct.error):
            del tables[b"VDMX"]

    tables.pop(b"DSIG", None)  # any signature is invalid after re-encoding
    tables[b"head"] = bytes(head)
    return _build_sfnt(version, tables)


def decompress_mtx(data: bytes) -> bytes:
    """MTX payload (starting at its 10-byte header: version 3, copy limit, offset2, offset3) -> a TrueType font
    (sfnt bytes)."""
    data = bytes(data)
    if len(data) < 10:
        raise MtxError("MTX header truncated")
    if data[0] != 3:
        raise MtxError("unsupported MTX version %d" % data[0])
    off2 = int.from_bytes(data[4:7], "big")
    off3 = int.from_bytes(data[7:10], "big")
    if not 10 <= off2 <= off3 <= len(data):
        raise MtxError("bad MTX block offsets")
    try:
        ctf = _lzcomp_decode(data[10:off2])
        push = _lzcomp_decode(data[off2:off3]) if off3 > off2 else b""
        code = _lzcomp_decode(data[off3:]) if len(data) > off3 else b""
        return _ctf_to_sfnt(ctf, push, code)
    except MtxError:
        raise
    except (IndexError, struct.error, ValueError, OverflowError) as exc:
        raise MtxError("malformed MTX data: %s" % exc) from None
