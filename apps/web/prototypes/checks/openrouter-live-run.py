import json
import urllib.request
from pathlib import Path

origin = 'http://127.0.0.1:43873'
output = Path('docs/plans/evidence/openrouter-live')
inputs = [
    '我是来听琴的访客。我们先聊聊音乐，实际聊了五分钟后，一起到轻音社活动室听钢琴。请按现在的时间继续。',
    '我认真听了十分钟钢琴，然后称赞刚才那段旋律，请继续聊音乐，仍然留在活动室。',
    '又过了五分钟，我们收好乐谱，一起走到学校走廊，约好明天继续练习。',
]
for number, text in enumerate(inputs, 1):
    request = urllib.request.Request(origin + '/script-api/sessions/script-gushengman/send', data=json.dumps({'text': text}).encode(), headers={'Content-Type': 'application/json'})
    events = []
    with urllib.request.urlopen(request, timeout=240) as response, (output / f'live-turn-{number}.ndjson').open('wb') as artifact:
        for line in response:
            artifact.write(line)
            artifact.flush()
            event = json.loads(line)
            events.append(event)
            if event['type'] in ['commit', 'completed', 'error']:
                print(json.dumps(event, ensure_ascii=False), flush=True)
    if events[-1]['type'] != 'completed':
        break
with urllib.request.urlopen(origin + '/script-api/sessions/script-gushengman/live-evidence') as response:
    evidence = json.load(response)
(output / 'live-evidence.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2))
print(json.dumps(evidence, ensure_ascii=False), flush=True)
