from PIL import Image,ImageDraw,ImageFont,ImageChops,ImageStat
import json,hashlib,math
from pathlib import Path
p=Path('evidence/seedream55-candidate');out={}
for name in ['full-scene','native-alpha','local-hat-edit']:
 im=Image.open(p/(name+'-gpt-low.png'));a=im.convert('RGBA').getchannel('A');hist=a.histogram();total=im.width*im.height
 out[name]={'size':list(im.size),'format':im.format,'mode':im.mode,'hasAlpha':'A' in im.getbands(),'alphaMin':a.getextrema()[0],'alphaMax':a.getextrema()[1],'zeroAlphaRatio':hist[0]/total,'partialAlphaRatio':sum(hist[1:255])/total,'opaqueRatio':hist[255]/total,'sha256':hashlib.sha256((p/(name+'-gpt-low.png')).read_bytes()).hexdigest()}
base=Image.open(p/'fixed-edit-source.png').convert('RGB');edit=Image.open(p/'local-hat-edit-gpt-low.png').convert('RGB')
delta=ImageChops.difference(base,edit);mask=Image.new('L',base.size,255);ImageDraw.Draw(mask).rectangle((710,290,988,476),fill=0)
count=mask.histogram()[255];stats=ImageStat.Stat(delta,mask);inside=ImageStat.Stat(delta,ImageChops.invert(mask));channels=delta.split();mx=ImageChops.lighter(ImageChops.lighter(channels[0],channels[1]),channels[2]);h=mx.histogram(mask)
out['preservation']={'editRegion':[710,290,989,477],'outsidePixelCount':count,'outsideMae':sum(stats.mean)/3,'outsideRmse':math.sqrt(sum(v*v for v in stats.rms)/3),'outsideExactPixelsRatio':h[0]/count,'outsideWithin8RgbRatio':sum(h[:9])/count,'outsideChangedAbove16RgbRatio':sum(h[17:])/count,'insideMae':sum(inside.mean)/3,'note':'No alignment, resizing or color normalization; excludes a fixed rectangular hat region, not a perfect segmentation.'}
alpha=Image.open(p/'native-alpha-gpt-low.png').convert('RGBA')
for label,color in [('light','#f3f1ed'),('dark','#171923')]:
 bg=Image.new('RGBA',alpha.size,color);bg.alpha_composite(alpha);bg.convert('RGB').save(p/'qa'/('alpha-'+label+'.png'))
 # Edge crop enlarges source pixels without inventing detail.
 bg.crop((300,100,880,520)).resize((1160,840)).convert('RGB').save(p/'qa'/('alpha-edge-'+label+'.png'))
# Source/edit/difference sheet: diagnostic difference amplified 4x, never used as deliverable.
font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',25)
sheet=Image.new('RGB',(1568,590),'#f5f3f0');d=ImageDraw.Draw(sheet)
for i,(name,img) in enumerate([('Fixed shared source',Image.open(p/'fixed-edit-source.png')),('GPT 2.6 low / high reasoning',Image.open(p/'local-hat-edit-gpt-low.png')),('Absolute difference x4',delta.point(lambda n:min(n*4,255)))]):
 sheet.paste(img.resize((500,500)),(18+i*520,60));d.text((18+i*520,16),name,font=font,fill='#222222')
sheet.save(p/'qa'/'local-edit-comparison.png')
(p/'measurements.json').write_text(json.dumps(out,indent=2));print(json.dumps(out,indent=2))
