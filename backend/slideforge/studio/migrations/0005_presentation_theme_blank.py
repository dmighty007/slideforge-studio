from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("studio", "0004_share_link"),
    ]

    operations = [
        migrations.AlterField(
            model_name="presentation",
            name="presentation_theme",
            field=models.CharField(default="blank", max_length=64),
        ),
    ]
