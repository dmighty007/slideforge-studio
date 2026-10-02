from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("studio", "0001_initial"),
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
                    ("export", "Export"),
                    ("other", "Other"),
                ],
                default="other",
                max_length=16,
            ),
        ),
    ]
