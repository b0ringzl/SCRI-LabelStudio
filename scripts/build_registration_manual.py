"""Build the two standalone registration manuals from the canonical Markdown.

Requires reportlab; --font can specify an embeddable TrueType font with Chinese.
System fonts are never copied into the repository. PDFs contain no survey assets.
"""
import argparse
import hashlib
from html import escape
import json
from pathlib import Path
import re
import shutil
import textwrap

from reportlab import rl_config
from reportlab.graphics.shapes import Drawing, Line, Rect, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import BaseDocTemplate, Frame, KeepTogether, PageBreak, PageTemplate, Paragraph, Spacer, Table, TableStyle, Preformatted, XPreformatted
from reportlab.platypus.tableofcontents import TableOfContents
from manual_illustrations import FIGURES, ManualFigure, load_figures, publish_svgs

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT/'docs'/'REGISTRATION_MANUAL.md'
REVISION = '2026-11-10'
INK, MUTED, PURPLE = colors.HexColor('#16243b'), colors.HexColor('#64748b'), colors.HexColor('#7565db')
PALE, BORDER = colors.HexColor('#f3f1fc'), colors.HexColor('#dfe5ef')
WIDTH = A4[0]-88


def sha(path):
    data = path.read_bytes()
    if path.suffix in ('.md', '.py', '.json', '.svg'):
        data = data.replace(b'\r\n', b'\n')
    return hashlib.sha256(data).hexdigest()


def register_fonts(font):
    candidates = [Path(font)] if font else [Path('C:/Windows/Fonts/msyh.ttc'),
        Path('/usr/share/fonts/truetype/noto/NotoSansSC-Regular.ttf')]
    for path in candidates:
        if path.is_file():
            pdfmetrics.registerFont(TTFont('Body', str(path), subfontIndex=0))
            bold = path.with_name('msyhbd.ttc') if path.name == 'msyh.ttc' else path
            pdfmetrics.registerFont(TTFont('Strong', str(bold), subfontIndex=0))
            return path.name
    if font:
        raise SystemExit('Requested font does not exist')
    pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
    pdfmetrics.registerFontFamily('STSong-Light', normal='STSong-Light', bold='STSong-Light')
    return 'STSong-Light (reader CJK support required)'


def inline(text):
    text = escape(text).replace('\u2011', '-').replace('\u2013', '-').replace('\u2014', '-')
    text = re.sub(r'`([^`]+)`', r'<font color="#4f46a0">\1</font>', text)
    text = re.sub(r'\*\*([^*]+)\*\*', r'<b>\1</b>', text)
    return text


def workflow(font):
    d = Drawing(WIDTH, 65)
    labels = ['数据准备', '粗配准', '同名点精调', '投影核验', '保存与交接']
    gap = 13
    width = (WIDTH-4*gap)/5
    for i, label in enumerate(labels):
        x = i*(width+gap)
        d.add(Rect(x, 20, width, 31, rx=6, fillColor=PALE, strokeColor=BORDER))
        d.add(String(x+width/2, 31, label, fontName=font, fontSize=9.4, textAnchor='middle', fillColor=INK))
        if i<4:
            d.add(Line(x+width+2, 35, x+width+gap-2, 35, strokeColor=PURPLE))
            d.add(Line(x+width+gap-6, 38, x+width+gap-2, 35, strokeColor=PURPLE))
            d.add(Line(x+width+gap-6, 32, x+width+gap-2, 35, strokeColor=PURPLE))
    return d


def interface(font):
    d = Drawing(WIDTH, 213)
    d.add(Rect(0, 0, WIDTH, 207, rx=8, fillColor=colors.white, strokeColor=BORDER))
    d.add(Rect(0, 168, WIDTH, 39, fillColor=PALE, strokeColor=None))
    for i, label in enumerate(['1 粗配准', '2 同名点精调', '3 投影核验']):
        d.add(String(13+i*112, 184, label, fontName=font, fontSize=10, fillColor=PURPLE if i==1 else INK))
    d.add(String(WIDTH-73, 184, '更多设置', fontName=font, fontSize=9, fillColor=MUTED))
    d.add(String(13, 148, '上一帧  /  当前全景帧  /  下一帧', fontName=font, fontSize=9, fillColor=MUTED))
    d.add(String(WIDTH-90, 148, '视角同步', fontName=font, fontSize=9, fillColor=MUTED))
    half = (WIDTH-36)/2
    for x, title, desc in [(12,'三维点云','先点静态三维角点'),(24+half,'全景影像','再点同一物理位置')]:
        d.add(Rect(x, 18, half, 113, rx=5, fillColor=colors.HexColor('#f8fafc'), strokeColor=BORDER))
        d.add(String(x+12, 111, title, fontName=font, fontSize=11, fillColor=INK))
        d.add(String(x+12, 33, desc, fontName=font, fontSize=9.4, fillColor=MUTED))
        d.add(String(x+half/2, 67, '#1', fontName=font, fontSize=21, fillColor=PURPLE, textAnchor='middle'))
    return d


class Manual(BaseDocTemplate):
    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph) and getattr(flowable, '_bookmark', None):
            key = flowable._bookmark
            title = flowable.getPlainText()
            self.canv.bookmarkPage(key)
            level=getattr(flowable,'_outline_level',0)
            self.canv.addOutlineEntry(title, key, level, False)
            if level==0:
                self.notify('TOCEntry', (0, title, self.page, key))


def build(platform, output, fonts):
    body, strong = fonts
    pdfmetrics.registerFontFamily(body, normal=body, bold=strong, italic=body, boldItalic=strong)
    styles = {
        'body': ParagraphStyle('body', fontName=body, fontSize=10.1, leading=16.2, textColor=INK,
                               wordWrap='CJK', spaceAfter=7),
        'h1': ParagraphStyle('h1', fontName=strong, fontSize=19, leading=26, textColor=INK, spaceAfter=17, keepWithNext=True, wordWrap='CJK'),
        'h2': ParagraphStyle('h2', fontName=strong, fontSize=12.2, leading=19, textColor=PURPLE, spaceBefore=12, spaceAfter=7, keepWithNext=True, wordWrap='CJK'),
        'small': ParagraphStyle('small', fontName=body, fontSize=8.5, leading=13.5, textColor=MUTED, wordWrap='CJK', spaceAfter=7),
        'cell': ParagraphStyle('cell', fontName=body, fontSize=8.5, leading=13.2, textColor=INK, wordWrap='CJK'),
        'th': ParagraphStyle('th', fontName=strong, fontSize=8.8, leading=13.4, textColor=INK, wordWrap='CJK'),
        'code': ParagraphStyle('code', fontName='Courier', fontSize=7.3, leading=10.8, textColor=INK,
                               backColor=colors.HexColor('#f5f7fb'), borderPadding=9, spaceBefore=5, spaceAfter=13),
    }
    doc = Manual(str(output), pagesize=A4, leftMargin=44, rightMargin=44, topMargin=53, bottomMargin=46,
                 title=f'点云与全景影像配准模块操作手册 - {platform}', author='SCRI Labeling',
                 subject=f'0.15.0 / manual revision {REVISION}', pageCompression=1)
    def decorate(canvas, _doc):
        canvas.setFillColor(MUTED)
        canvas.setFont(body, 8)
        canvas.drawString(44, A4[1]-30, f'SCRI Labeling  |  配准模块操作手册  |  {platform}')
        canvas.setStrokeColor(BORDER)
        canvas.line(44, A4[1]-36, A4[0]-44, A4[1]-36)
        canvas.drawString(44, 26, f'适用软件 0.15.0   /   修订 {REVISION}')
        canvas.drawRightString(A4[0]-44, 26, str(_doc.page))
    frame = Frame(44, 46, WIDTH, A4[1]-99, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates(PageTemplate(id='manual', frames=[frame], onPage=decorate))
    p = lambda text, style='body': Paragraph(inline(text), styles[style])
    story = [Spacer(1, 48), Paragraph('SCRI / FIELD GUIDE', ParagraphStyle('eyebrow',fontName=strong,fontSize=11,leading=17,textColor=PURPLE)),
        Spacer(1, 22), Paragraph('点云与全景影像<br/>配准模块操作手册', ParagraphStyle('cover',fontName=strong,fontSize=29,leading=41,textColor=INK)),
        Spacer(1, 18), p(f'{platform} 版', 'h1'), p('从数据准备、粗配准到同名点精调、投影核验和成果交接。'),
        Spacer(1, 12), workflow(body), Spacer(1, 18),
        p('适用版本：0.15.0  |  手册第 3 版 · 操作图解版'), p(f'修订日期：{REVISION}'),
        p('面向：标注员 / 数据准备人员 / 算法与平台开发同事'),
        Spacer(1, 25), p('先用源位姿与同名点跑通流程，再增加自动候选。拟合残差、观察同步和自动候选通过均不等于独立精度验收。', 'small'),
        p('依据 0.15.0 当前源码核对；界面截图使用合成建筑教学样本，操作编号为后期矢量引导。无真实测区影像或设备参数。', 'small'), PageBreak()]
    story += [p('本平台快速开始', 'h1')]
    if platform=='Windows':
        story += [p('1. 安装 Node.js 20+，完整解压平台包。'), p('2. 双击 Start-Atlas-Windows.bat；或在 PowerShell 中运行：'),
                  Preformatted('.\\Start-Atlas-Windows.bat', styles['code']),
                  p('3. 使用终端打印的 127.0.0.1 地址，保持进程运行。'),
                  p('4. 大点云自动导入另需 Python 3.10+：'), Preformatted('.\\Import-Scene-Windows.bat "D:\\survey\\dataset"', styles['code']),
                  p('路径是示例。PowerShell 的多行语法与 macOS shell 不同；第 3 章的长 Python 命令可直接合并成一行。')]
    else:
        story += [p('1. 安装 Node.js 20+，完整解压平台包。'), p('2. 在终端进入解压目录后运行：'),
                  Preformatted('sh ./Start-Atlas-macOS.command', styles['code']),
                  p('3. 使用终端打印的 127.0.0.1 地址，保持进程运行。'),
                  p('4. 大点云自动导入另需 Python 3.10+：'), Preformatted('sh ./Import-Scene-macOS.command "/Users/you/survey/dataset"', styles['code']),
                  p('路径是示例。两平台使用相同的独立 CPU 配准后端；先运行对应的 Setup-Registration 启动器。')]
    story += [Spacer(1, 12), p('第一次先做这五件事', 'h2'), p('选数据 → 检查粗位姿 → 选 6-10 对静态同名点 → 用未参与拟合的地物核验 → 保存并导出。'),
              p('没有模型权重也能按以上路线工作。不要通过单纯拖动观察视图代替修改标定位姿。'), PageBreak(), p('目录', 'h1')]
    toc = TableOfContents()
    toc.levelStyles = [ParagraphStyle('toc', fontName=body, fontSize=10, leading=19, textColor=INK, wordWrap='CJK', spaceBefore=5)]
    story += [toc, PageBreak()]
    figures={figure['id']:figure for figure in load_figures()}
    lines = SOURCE.read_text(encoding='utf-8').splitlines()
    i, chapter = 0, 0
    while i<len(lines):
        line=lines[i]
        if not line.strip() or (chapter==0 and not line.startswith('## ')):
            i+=1;continue
        if line.startswith('## '):
            chapter+=1
            if chapter>1: story.append(PageBreak())
            heading=p(line[3:],'h1');heading._bookmark=f'chapter-{chapter}';story.append(heading)
            if chapter==5:
                story += [interface(body),p('图 1  界面结构示意，按实际控件名称绘制；不是界面截图或测区数据。','small')]
            i+=1;continue
        if line.startswith('### '):
            if line.startswith('### 图解 '):
                story.append(PageBreak())
                heading=p(line[4:],'h1');heading._bookmark='figure-'+line.split(' ')[2];heading._outline_level=1;story.append(heading)
                i+=1;continue
            if line.startswith('### 3.2'):
                story += [PageBreak(),p('3. 数据准备（续）：本机导入','h1')]
            if line.startswith('### 6.3'):
                story += [PageBreak(),p('6. 位姿 JSON（续）：其他输入','h1')]
            story.append(p(line[4:],'h2'));i+=1;continue
        image_match=re.fullmatch(r'!\[([^]]+)\]\(manuals/figures/(figure-[^)]+)\.svg\)',line)
        if image_match:
            figure=figures[image_match[2]]
            image_width=min(WIDTH,440*figure['size'][0]/figure['size'][1])
            illustration=ManualFigure(figure,image_width,body);illustration.hAlign='CENTER'
            story += [illustration,Spacer(1,9),p(image_match[1],'small')]
            i+=1;continue
        if line.startswith('```'):
            block=[];i+=1
            while i<len(lines) and not lines[i].startswith('```'):
                raw=lines[i]
                block += textwrap.wrap(raw, width=91, replace_whitespace=False, drop_whitespace=False, break_long_words=True, break_on_hyphens=False) or ['']
                i+=1
            code = escape('\n'.join(block))
            code = re.sub(r'([^\x00-\x7f]+)', lambda m:f'<font name="{body}">{m[0]}</font>', code)
            story.append(KeepTogether([XPreformatted(code,styles['code'])]));i+=1;continue
        if line.startswith('|'):
            rows=[]
            while i<len(lines) and lines[i].startswith('|'):
                row=[cell.strip() for cell in lines[i].strip().strip('|').split('|')]
                if not all(re.fullmatch(r':?-+:?',cell.replace(' ','')) for cell in row):rows.append(row)
                i+=1
            columns=len(rows[0]);ratios=[.32,.68] if columns==2 else [.24,.36,.40]
            if chapter==15:ratios=[.47,.53]
            cells=[[p(cell,'th' if index==0 else 'cell') for cell in row] for index,row in enumerate(rows)]
            table=Table(cells,colWidths=[WIDTH*r for r in ratios],repeatRows=1,hAlign='LEFT')
            table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),PALE),('VALIGN',(0,0),(-1,-1),'TOP'),
                ('LINEBELOW',(0,0),(-1,0),.7,BORDER),('LINEBELOW',(0,1),(-1,-1),.3,BORDER),
                ('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),
                ('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7)]))
            story += [table,Spacer(1,11)];continue
        paragraph=[line];i+=1
        while i<len(lines) and lines[i].strip() and not lines[i].startswith(('#','```','|','![')) and not re.match(r'\d+\. ',lines[i]):
            paragraph.append(lines[i]);i+=1
        story.append(p(' '.join(paragraph)))
    doc.multiBuild(story)
    return doc.page


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--font',help='Embeddable CJK TrueType/collection font')
    args=parser.parse_args()
    rl_config.invariant=1
    font_name=register_fonts(args.font)
    fonts=('Body','Strong') if font_name.startswith('msyh') or args.font or font_name.endswith('.ttf') else ('STSong-Light','STSong-Light')
    publish_svgs()
    output=ROOT/'output'/'pdf';published=ROOT/'docs'/'manuals'
    output.mkdir(parents=True,exist_ok=True);published.mkdir(parents=True,exist_ok=True)
    manifest={'revision':REVISION,'softwareVersion':'0.15.0','sourceSha256':sha(SOURCE),
              'builderSha256':sha(Path(__file__)),'illustratorSha256':sha(ROOT/'scripts'/'manual_illustrations.py'),
              'figureCount':len(load_figures()),'figureAssets':[
                  {'file':path.relative_to(published).as_posix(),'sha256':sha(path)}
                  for path in sorted(FIGURES.rglob('*')) if path.is_file()],
              'font':font_name,'editions':[]}
    for platform in ('Windows','macOS'):
        path=output/f'Registration-Manual-{platform}.pdf'
        pages=build(platform,path,fonts)
        shutil.copyfile(path,published/path.name)
        manifest['editions'].append({'file':path.name,'pages':pages,'sha256':sha(path)})
        print(f'{platform}: {pages} pages -> {path}')
    (published/'build-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


if __name__=='__main__':
    main()
