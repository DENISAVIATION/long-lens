import json, os, numpy as np, soundfile as sf
from kokoro import KPipeline
lines = json.load(open('voice/lines.json'))
os.makedirs('out', exist_ok=True)
pipe = KPipeline(lang_code='a')
for voice in ['am_michael', 'am_liam', 'am_fenrir', 'am_echo']:
    for key, text in lines:
        chunks = [np.asarray(a) for _, _, a in pipe(text, voice=voice, speed=1.0)]
        sf.write(f'out/{voice}__{key}.wav', np.concatenate(chunks), 24000)
print(sorted(os.listdir('out')))
