"""Create redistributable, illustrative import fixtures from scratch."""
import os
import sys
from pathlib import Path
from PIL import Image, ImageDraw
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE
from pptx.oxml.xmlchemy import OxmlElement
from pptx.util import Inches, Pt

sys.path.insert(0, str(Path('backend').resolve()))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'slideforge.desktop.settings')
os.environ.setdefault('SLIDEFORGE_DATA_DIR', '/tmp/sf-release-fixtures')
import django
django.setup()


def get_sample_deck():
    from slideforge.bridge.keynote.tests import sample_deck

    return sample_deck()
out = Path(__file__).parent / 'evidence'
(out / 'illustrative.key').write_bytes(get_sample_deck())
image = Image.new('RGB', (640, 360), '#123e44')
draw = ImageDraw.Draw(image)
draw.rectangle((50, 60, 280, 300), fill='#5eead4')
draw.ellipse((350, 60, 590, 300), fill='#e0f2fe')
image.save(out / 'fixture-image.png')
p = Presentation()
p.slide_width = Inches(12.8)
p.slide_height = Inches(7.2)
s = p.slides.add_slide(p.slide_layouts[6])
t = s.shapes.add_textbox(Inches(.6), Inches(.4), Inches(11.5), Inches(.9))
t.text = 'Illustrative import: editable objects'
t.text_frame.paragraphs[0].font.size = Pt(30)
c = CategoryChartData()
c.categories = ['Control', 'Low dose', 'High dose']
c.add_series('Illustrative response', [12, 24, 38])
s.shapes.add_chart(
    XL_CHART_TYPE.COLUMN_CLUSTERED,
    Inches(.7),
    Inches(1.7),
    Inches(6.4),
    Inches(4.7),
    c,
)
table = s.shapes.add_table(3, 2, Inches(8), Inches(1.8), Inches(3.8), Inches(1.8)).table
for r, vals in enumerate([['Condition', 'Response'], ['Control', '12'], ['High dose', '38']]):
    for col, v in enumerate(vals):
        table.cell(r, col).text = v
pic = s.shapes.add_picture(str(out / 'fixture-image.png'), Inches(8), Inches(4), width=Inches(3.8))
pic.crop_left = .1
s.notes_slide.notes_text_frame.text = 'Illustrative speaker notes: verify these survive import.'
trans = OxmlElement('p:transition')
trans.append(OxmlElement('p:fade'))
s._element.append(trans)
s2 = p.slides.add_slide(p.slide_layouts[6])
tf = s2.shapes.add_textbox(Inches(1), Inches(1), Inches(10), Inches(4)).text_frame
for i, text in enumerate(['Illustrative bullet list', 'Keep fonts and spacing', 'Check the second level']):
    para = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
    para.text = text
    para.level = 1 if i == 2 else 0
    para.font.size = Pt(28)
p.save(out / 'illustrative.pptx')
print('Generated synthetic PowerPoint and Keynote fixtures; no user documents copied.')
