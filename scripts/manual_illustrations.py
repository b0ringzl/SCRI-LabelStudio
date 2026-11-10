"""Render handbook callouts as vector PDF overlays and portable SVGs.

Screenshots are unmodified UI captures with a shareable synthetic building.
Panels only crop/rearrange captures. Purple numbers are editorial callouts;
yellow numbers inside the UI remain the application's actual tie-point IDs.
"""
import base64
from functools import lru_cache
from html import escape
from io import BytesIO
import json
import math
from pathlib import Path
from PIL import Image

from reportlab.lib import colors
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Flowable

ROOT = Path(__file__).resolve().parents[1]
FIGURES = ROOT/'docs'/'manuals'/'figures'
SPEC = FIGURES/'figures.json'
PURPLE = '#7557d5'


def load_figures():
    return json.loads(SPEC.read_text(encoding='utf-8'))['figures']


@lru_cache(maxsize=64)
def crop_capture(source, crop):
    """Preserve source pixels; omit the unused full-screen area in each panel."""
    path=FIGURES/source
    assert path.read_bytes().startswith(b'\x89PNG\r\n\x1a\n'), 'Normalize screenshot encoding to PNG before publishing'
    x,y,w,h=crop
    with Image.open(path) as image:
        assert 0<=x and 0<=y and x+w<=image.width and y+h<=image.height, 'Crop exceeds source screenshot'
        pixels=image.crop((x,y,x+w,y+h)).convert('RGB')
    buffer=BytesIO();pixels.save(buffer,format='PNG',optimize=True)
    return buffer.getvalue()


def arrow_head(start, end):
    angle = math.atan2(end[1]-start[1], end[0]-start[0])
    return [end, [end[0]-12*math.cos(angle-.5),end[1]-12*math.sin(angle-.5)],
            [end[0]-12*math.cos(angle+.5),end[1]-12*math.sin(angle+.5)]]


class ManualFigure(Flowable):
    def __init__(self, spec, width, font):
        super().__init__()
        self.spec, self.font = spec, font
        self.width = width
        self.height = width*spec['size'][1]/spec['size'][0]

    def draw(self):
        spec, c = self.spec, self.canv
        w,h = spec['size']; c.saveState(); c.scale(self.width/w,self.width/w)
        c.setFillColor(colors.white);c.rect(0,0,w,h,fill=1,stroke=0)
        for panel in spec.get('panels',[]):
            x,y,pw,ph = panel['at'];sx,sy,sw,sh = panel['crop']
            reader=ImageReader(BytesIO(crop_capture(panel['source'],tuple(panel['crop']))))
            c.drawImage(reader,x,h-y-ph,pw,ph)
            c.setStrokeColor(colors.HexColor('#dfe5ef'));c.setLineWidth(1)
            c.rect(x,h-y-ph,pw,ph,fill=0,stroke=1)
        for shape in spec.get('shapes',[]):
            kind=shape['type'];colour=colors.HexColor(shape.get('color',PURPLE))
            c.setFillColor(colour);c.setStrokeColor(colour)
            if kind=='text':
                c.setFont(self.font,shape.get('size',24));c.drawString(shape['x'],h-shape['y']-shape.get('size',24)*.82,shape['text'])
            elif kind=='rect':
                x,y,sw,sh=shape['box'];c.roundRect(x,h-y-sh,sw,sh,8,fill=int(shape.get('fill',False)),stroke=1)
            elif kind=='line':
                a,b=shape['from'],shape['to'];c.setLineWidth(shape.get('width',3));c.line(a[0],h-a[1],b[0],h-b[1])
            elif kind=='circle':
                c.circle(shape['x'],h-shape['y'],shape.get('r',6),fill=1,stroke=0)
        for pin in spec.get('pins',[]):
            bx,by=pin['badge'];tx,ty=pin['target'];c.setFillColor(colors.HexColor(PURPLE));c.setStrokeColor(colors.HexColor(PURPLE));c.setLineWidth(3)
            c.line(bx,h-by,tx,h-ty);path=c.beginPath()
            for i,(x,y) in enumerate(arrow_head([bx,by],[tx,ty])):
                (path.moveTo if i==0 else path.lineTo)(x,h-y)
            path.close();c.drawPath(path,fill=1,stroke=0)
            c.setStrokeColor(colors.white);c.setLineWidth(2);c.circle(bx,h-by,21,fill=1,stroke=1)
            c.setFillColor(colors.white);c.setFont(self.font,25);c.drawCentredString(bx,h-by-8,str(pin['n']))
        c.restoreState()


def publish_svgs():
    """Use the exact same panels/pins for the GitHub Markdown edition."""
    for spec in load_figures():
        w,h=spec['size'];parts=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">',
                               '<rect width="100%" height="100%" fill="white"/>']
        for i,panel in enumerate(spec.get('panels',[])):
            x,y,pw,ph=panel['at'];encoded=base64.b64encode(crop_capture(panel['source'],tuple(panel['crop']))).decode('ascii')
            parts += [f'<image x="{x}" y="{y}" width="{pw}" height="{ph}" preserveAspectRatio="none" href="data:image/png;base64,{encoded}"/>',
                f'<rect x="{x}" y="{y}" width="{pw}" height="{ph}" fill="none" stroke="#dfe5ef"/>']
        for shape in spec.get('shapes',[]):
            kind=shape['type'];colour=shape.get('color',PURPLE)
            if kind=='text':
                parts.append(f'<text x="{shape["x"]}" y="{shape["y"]+shape.get("size",24)*.82}" font-family="Microsoft YaHei,Noto Sans CJK SC,sans-serif" font-size="{shape.get("size",24)}" fill="{colour}">{escape(shape["text"])}</text>')
            elif kind=='rect':
                x,y,sw,sh=shape['box'];parts.append(f'<rect x="{x}" y="{y}" width="{sw}" height="{sh}" rx="8" fill="{colour if shape.get("fill") else "none"}" stroke="{colour}"/>')
            elif kind=='line':
                a,b=shape['from'],shape['to'];parts.append(f'<line x1="{a[0]}" y1="{a[1]}" x2="{b[0]}" y2="{b[1]}" stroke="{colour}" stroke-width="{shape.get("width",3)}"/>')
            elif kind=='circle':
                parts.append(f'<circle cx="{shape["x"]}" cy="{shape["y"]}" r="{shape.get("r",6)}" fill="{colour}"/>')
        for pin in spec.get('pins',[]):
            bx,by=pin['badge'];tx,ty=pin['target'];points=' '.join(f'{x},{y}' for x,y in arrow_head([bx,by],[tx,ty]))
            parts += [f'<line x1="{bx}" y1="{by}" x2="{tx}" y2="{ty}" stroke="{PURPLE}" stroke-width="3"/>',
                f'<polygon points="{points}" fill="{PURPLE}"/>',
                f'<circle cx="{bx}" cy="{by}" r="21" fill="{PURPLE}" stroke="white" stroke-width="2"/>',
                f'<text x="{bx}" y="{by+8}" text-anchor="middle" font-family="sans-serif" font-size="25" fill="white">{pin["n"]}</text>']
        parts.append('</svg>')
        (FIGURES/f'{spec["id"]}.svg').write_text('\n'.join(parts)+'\n',encoding='utf-8')
