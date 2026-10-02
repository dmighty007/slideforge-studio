from datetime import timedelta

from django.core.management.base import BaseCommand

from ...asset_cleanup import collect_unused_assets


class Command(BaseCommand):
    help = "Delete uploaded files that no saved presentation or revision uses any more."

    def add_arguments(self, parser):
        parser.add_argument("--grace-hours", type=float, default=24, help="keep unreferenced uploads younger than this")
        parser.add_argument("--dry-run", action="store_true", help="report what would be deleted")

    def handle(self, *args, grace_hours, dry_run, **options):
        stats = collect_unused_assets(grace=timedelta(hours=grace_hours), dry_run=dry_run)
        verb = "Would delete" if dry_run else "Deleted"
        self.stdout.write(
            f"{verb} {stats['asset_rows']} unused assets and {stats['orphan_files']} orphan files "
            f"({stats['bytes'] / 1e6:.1f} MB)"
        )
