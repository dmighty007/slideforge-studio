from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("studio", "0002_asset_video_type"),
    ]

    operations = [
        migrations.AlterField(
            model_name="asset",
            name="asset_type",
            field=models.CharField(
                choices=[
                    ("image", "Image"),
                    ("video", "Video"),
                    ("pdf", "PDF"),
                    ("molecule", "Molecule"),
                    ("export", "Export"),
                    ("other", "Other"),
                ],
                default="other",
                max_length=16,
            ),
        ),
    ]
