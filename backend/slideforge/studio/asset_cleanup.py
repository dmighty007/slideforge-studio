"""Delete uploaded files that no saved presentation uses any more.

Decks reference uploads only by URL (".../media/assets/<name>"), and the same file can be used by several decks
(duplicated projects, pasted elements), so files are never deleted together with a deck. Instead this sweep removes
files that no presentation or revision references and that are older than a grace period, which protects uploads
sitting in edits that have not been saved yet.
"""

import json
import logging
import re
import time
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.utils import timezone

from .models import Asset, Presentation, PresentationRevision

logger = logging.getLogger(__name__)

ASSET_NAME_RE = re.compile(r"assets/([0-9a-f]{32}\.[A-Za-z0-9]{1,10})")
DEFAULT_GRACE = timedelta(hours=24)


def referenced_asset_names() -> set[str]:
    names: set[str] = set()
    for state, bridge_result in Presentation.objects.values_list("state_json", "bridge_result_json").iterator():
        names.update(ASSET_NAME_RE.findall(json.dumps(state)))
        names.update(ASSET_NAME_RE.findall(json.dumps(bridge_result)))
    for (state,) in PresentationRevision.objects.values_list("state_json").iterator():
        names.update(ASSET_NAME_RE.findall(json.dumps(state)))
    return names


def collect_unused_assets(*, grace: timedelta = DEFAULT_GRACE, dry_run: bool = False) -> dict:
    """Remove unreferenced uploads older than ``grace``. Returns counts and freed bytes."""
    referenced = referenced_asset_names()
    cutoff = timezone.now() - grace
    stats = {"asset_rows": 0, "orphan_files": 0, "bytes": 0}

    for asset in Asset.objects.filter(created_at__lt=cutoff).iterator():
        name = Path(asset.file.name or "").name
        if name in referenced:
            continue
        size = _file_size(asset.file)
        stats["asset_rows"] += 1
        stats["bytes"] += size
        if not dry_run:
            if asset.file:
                asset.file.delete(save=False)
            asset.delete()

    # Files whose Asset row is gone (e.g. its presentation was deleted) but that nothing references any more.
    assets_dir = Path(settings.MEDIA_ROOT) / "assets"
    if assets_dir.is_dir():
        known = {Path(name).name for name in Asset.objects.values_list("file", flat=True)}
        oldest_allowed = time.time() - grace.total_seconds()
        for path in assets_dir.iterdir():
            if not path.is_file() or path.name in known or path.name in referenced:
                continue
            if path.stat().st_mtime > oldest_allowed:
                continue
            stats["orphan_files"] += 1
            stats["bytes"] += path.stat().st_size
            if not dry_run:
                path.unlink(missing_ok=True)

    if stats["asset_rows"] or stats["orphan_files"]:
        logger.info("Asset cleanup%s: %s", " (dry run)" if dry_run else "", stats)
    return stats


def _file_size(field) -> int:
    try:
        return field.size if field else 0
    except OSError:
        return 0
