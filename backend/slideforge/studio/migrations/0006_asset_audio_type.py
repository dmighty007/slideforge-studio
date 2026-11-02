from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("studio", "0005_presentation_theme_blank"),
    ]

    operations = [
        migrations.AlterField(
            model_name="asset",
            name="asset_type",
            field=models.CharField(
                choices=[
                    ("image", "Image"),
                    ("video", "Video"),
                    ("audio", "Audio"),
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
